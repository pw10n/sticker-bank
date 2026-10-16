package com.stickerbank.revocation

import com.stickerbank.chart.ChartQueries
import com.stickerbank.chart.RevokedStickerDto
import com.stickerbank.chart.TaskToggleResultDto
import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.StickerStatus
import com.stickerbank.routine.PlannedRoutine
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/** Sticker revocation (TDD 7.11). Callers hold the child lock inside one transaction. */
@Service
class JdbcRevocationService(private val jdbc: JdbcClient, private val queries: ChartQueries, private val clock: FamilyClock) :
    RevocationService {
    private val log = LoggerFactory.getLogger(JdbcRevocationService::class.java)

    private data class LiveSticker(val id: Long, val status: StickerStatus, val prizeRequestId: Long?)

    override fun revokeLocked(
        childId: Long,
        routineId: Long,
        planned: PlannedRoutine,
        date: LocalDate,
        taskId: Long,
        note: String?,
    ): TaskToggleResultDto {
        val today = clock.today()
        val completionExists =
            jdbc.sql("SELECT COUNT(*) FROM task_completion WHERE task_id = ? AND chart_date = ?").params(taskId, date)
                .query(Long::class.java).single() > 0
        val inRevision = planned.tasks.any { it.taskId == taskId }
        if (!inRevision || !completionExists) return TaskToggleResultDto(view(childId, planned, date, today), null, null)

        val sticker = jdbc.sql("SELECT id, status, prize_request_id FROM live_sticker WHERE routine_id = ? AND chart_date = ?")
            .params(routineId, date)
            .query { rs, _ ->
                LiveSticker(
                    rs.getLong("id"),
                    StickerStatus.valueOf(rs.getString("status")),
                    (rs.getObject("prize_request_id") as Number?)?.toLong(),
                )
            }.list().firstOrNull()

        if (sticker?.status == StickerStatus.USED) throw DomainException(ErrorCode.STICKER_USED)
        jdbc.sql("DELETE FROM task_completion WHERE task_id = ? AND chart_date = ?").params(taskId, date).update()
        if (sticker == null) return TaskToggleResultDto(view(childId, planned, date, today), null, null)

        val now = LocalDateTime.ofInstant(clock.now(), ZoneOffset.UTC)
        var requestCancelled = false
        // The sticker's pick choices stay on the revoked row, so re-earning offers the same set (FR-12.5).
        when (sticker.status) {
            StickerStatus.PENDING -> {
                val requestId = sticker.prizeRequestId
                jdbc.sql("UPDATE sticker SET prize_request_id = NULL WHERE id = ?").param(sticker.id).update()
                if (requestId != null) {
                    val remaining =
                        jdbc.sql("SELECT COUNT(*) FROM sticker WHERE prize_request_id = ? AND status = 'PENDING'").param(requestId)
                            .query(Long::class.java).single()
                    if (remaining == 0L) {
                        requestCancelled = jdbc.sql(
                            "UPDATE prize_request SET status = 'CANCELLED', cancelled_by = 'PARENT', " +
                                "cancel_reason = 'ALL_STICKERS_REVOKED', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'",
                        ).params(now, now, requestId).update() > 0
                    }
                }
            }
            else -> Unit
        }
        jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(sticker.id).update()
        val label = planned.tasks.first { it.taskId == taskId }.label
        jdbc.sql(
            "INSERT INTO sticker_revocation (sticker_id, child_id, chart_date, task_id, task_label, from_status, prize_request_id, " +
                "request_cancelled, note, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).params(
            listOf<Any?>(
                sticker.id, childId, date, taskId, label, sticker.status.name, sticker.prizeRequestId, requestCancelled,
                note?.takeIf { it.isNotBlank() }, now,
            ),
        ).update()
        log.info("sticker revoked childId={} routineId={} date={} stickerId={}", childId, routineId, date, sticker.id)
        return TaskToggleResultDto(
            view(childId, planned, date, today),
            null,
            RevokedStickerDto(sticker.id, sticker.status, sticker.prizeRequestId, requestCancelled),
        )
    }

    override fun revocationsFor(childId: Long, from: LocalDate, to: LocalDate): Map<LocalDate, List<RevocationDto>> = jdbc.sql(
        "SELECT r.sticker_id, r.child_id, r.chart_date, r.task_id, r.task_label, r.from_status, r.prize_request_id, " +
            "r.request_cancelled, r.note, r.revoked_at, s.routine_id, s.routine_name, s.routine_icon_key, " +
            "d.id AS design_id, d.name AS design_name, d.artwork_key FROM sticker_revocation r " +
            "JOIN sticker s ON s.id = r.sticker_id LEFT JOIN sticker_design d ON d.id = s.design_id " +
            "WHERE r.child_id = ? AND r.chart_date BETWEEN ? AND ? ORDER BY r.revoked_at, r.sticker_id",
    ).params(childId, from, to).query { rs, _ ->
        val designId = (rs.getObject("design_id") as Number?)?.toLong()
        RevocationDto(
            stickerId = rs.getLong("sticker_id"),
            childId = rs.getLong("child_id"),
            chartDate = rs.getObject("chart_date", LocalDate::class.java),
            routineId = (rs.getObject("routine_id") as Number?)?.toLong(),
            routineName = rs.getString("routine_name"),
            routineIconKey = rs.getString("routine_icon_key"),
            taskId = (rs.getObject("task_id") as Number?)?.toLong(),
            taskLabel = rs.getString("task_label"),
            fromStatus = StickerStatus.valueOf(rs.getString("from_status")),
            design = designId?.let { DesignRefDto(it, rs.getString("design_name"), rs.getString("artwork_key")) },
            prizeRequestId = (rs.getObject("prize_request_id") as Number?)?.toLong(),
            requestCancelled = rs.getBoolean("request_cancelled"),
            note = rs.getString("note"),
            revokedAt = rs.getObject("revoked_at", LocalDateTime::class.java).toInstant(ZoneOffset.UTC),
        )
    }.list().groupBy { it.chartDate }

    /** The routine's state as the parent sees it: there is no live sticker any more. */
    private fun view(childId: Long, planned: PlannedRoutine, date: LocalDate, today: LocalDate) = ChartQueries.routineDto(
        planned,
        date,
        today,
        queries.completions(childId, date, date)[date].orEmpty(),
        queries.stickers(childId, date, date)[planned.routineId to date],
        parent = true,
    )
}
