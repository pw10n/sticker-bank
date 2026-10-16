package com.stickerbank.chart

import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.routine.PlannedRoutine
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.LocalDate

/** A routine sticker joined to its live design (null design while UNCLAIMED). */
data class ChartStickerRow(
    val stickerId: Long,
    val routineId: Long,
    val chartDate: LocalDate,
    val status: StickerStatus,
    val design: DesignRefDto?,
    val prizeRequestId: Long? = null,
)

@Component
class ChartQueries(private val jdbc: JdbcClient) {
    fun childExists(childId: Long): Boolean =
        jdbc.sql("SELECT COUNT(*) FROM child WHERE id = ?").param(childId).query(Long::class.java).single() > 0

    /** Completed task ids per date for the child, one query. */
    fun completions(childId: Long, from: LocalDate, to: LocalDate): Map<LocalDate, Set<Long>> =
        jdbc.sql("SELECT chart_date, task_id FROM task_completion WHERE child_id = ? AND chart_date BETWEEN ? AND ?")
            .params(childId, from, to)
            .query { rs, _ -> rs.getObject("chart_date", LocalDate::class.java) to rs.getLong("task_id") }
            .list().groupBy({ it.first }, { it.second }).mapValues { it.value.toSet() }

    /** Routine stickers of the child in the range, keyed by (routineId, date), one query. */
    fun stickers(childId: Long, from: LocalDate, to: LocalDate): Map<Pair<Long, LocalDate>, ChartStickerRow> = jdbc.sql(
        "SELECT s.id, s.routine_id, s.chart_date, s.status, s.prize_request_id, d.id AS design_id, d.name, d.artwork_key " +
            "FROM live_sticker s " +
            "LEFT JOIN sticker_design d ON d.id = s.design_id " +
            "WHERE s.child_id = ? AND s.routine_id IS NOT NULL AND s.chart_date BETWEEN ? AND ?",
    ).params(childId, from, to).query { rs, _ ->
        val designId = rs.getObject("design_id") as Number?
        ChartStickerRow(
            stickerId = rs.getLong("id"),
            routineId = rs.getLong("routine_id"),
            chartDate = rs.getObject("chart_date", LocalDate::class.java),
            status = StickerStatus.valueOf(rs.getString("status")),
            design = designId?.let { DesignRefDto(it.toLong(), rs.getString("name"), rs.getString("artwork_key")) },
            prizeRequestId = (rs.getObject("prize_request_id") as Number?)?.toLong(),
        )
    }.list().associateBy { it.routineId to it.chartDate }

    fun unclaimedBefore(childId: Long, today: LocalDate): List<UnclaimedStickerDto> = jdbc.sql(
        "SELECT id, chart_date, routine_name, routine_icon_key FROM live_sticker " +
            "WHERE child_id = ? AND status = 'UNCLAIMED' AND chart_date < ? ORDER BY chart_date, id",
    ).params(childId, today).query { rs, _ ->
        UnclaimedStickerDto(
            rs.getLong("id"),
            rs.getObject("chart_date", LocalDate::class.java),
            rs.getString("routine_name"),
            rs.getString("routine_icon_key"),
        )
    }.list()

    companion object {
        fun stickerDto(row: ChartStickerRow, parent: Boolean): ChartStickerDto = ChartStickerDto(
            row.stickerId,
            row.status,
            row.design,
            if (parent) row.prizeRequestId else null,
            if (parent) row.status != StickerStatus.USED else null,
        )

        fun routineDto(
            planned: PlannedRoutine,
            date: LocalDate,
            today: LocalDate,
            completed: Set<Long>,
            sticker: ChartStickerRow?,
            parent: Boolean = false,
        ): ChartRoutineDto {
            val done = ChartRules.doneCount(planned.tasks.map { it.taskId }, completed)
            return ChartRoutineDto(
                routineId = planned.routineId,
                name = planned.name,
                iconKey = planned.iconKey,
                color = planned.color,
                state = ChartRules.deriveState(planned.skipped, sticker?.status, date, today, done),
                doneCount = done,
                taskCount = planned.tasks.size,
                tasks = planned.tasks.map { ChartTaskDto(it.taskId, it.label, it.iconKey, it.taskId in completed) },
                sticker = sticker?.let { stickerDto(it, parent) },
            )
        }
    }
}
