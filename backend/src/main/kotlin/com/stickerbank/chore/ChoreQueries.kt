package com.stickerbank.chore

import com.stickerbank.chart.ChartQueries
import com.stickerbank.chart.ChartStickerDto
import com.stickerbank.chart.ChartStickerRow
import com.stickerbank.chart.ChartTaskDto
import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerStatus
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

data class ChoreTaskRow(val taskId: Long, val label: String, val iconKey: String, val checked: Boolean)

/**
 * A chore with its tasks (in position order) and live sticker. The sticker reuses [ChartStickerRow], with the chore id in
 * its `routineId` slot, so [ChartQueries.stickerDto] builds the parent fields exactly as it does for a routine.
 */
data class ChoreRecord(
    val choreId: Long,
    val childId: Long,
    val name: String,
    val iconKey: String,
    val dueDate: LocalDate?,
    val createdAt: Instant,
    val removed: Boolean,
    val tasks: List<ChoreTaskRow>,
    val sticker: ChartStickerRow?,
) {
    val doneCount: Int get() = tasks.count { it.checked }

    fun state(today: LocalDate): ChoreState = ChoreRules.deriveState(sticker?.status, dueDate, today, doneCount, tasks.size)

    fun stickerDto(parent: Boolean): ChartStickerDto? = sticker?.let { ChartQueries.stickerDto(it, parent) }

    fun chartTasks(): List<ChartTaskDto> = tasks.map { ChartTaskDto(it.taskId, it.label, it.iconKey, it.checked) }

    fun toChartDto(today: LocalDate, parent: Boolean): ChartChoreDto = ChartChoreDto(
        choreId = choreId,
        name = name,
        iconKey = iconKey,
        dueDate = dueDate,
        state = state(today),
        doneCount = doneCount,
        taskCount = tasks.size,
        tasks = chartTasks(),
        sticker = stickerDto(parent),
    )

    fun toDto(today: LocalDate, parent: Boolean): ChoreDto {
        val state = state(today)
        return ChoreDto(
            choreId = choreId,
            childId = childId,
            name = name,
            iconKey = iconKey,
            dueDate = dueDate,
            state = state,
            doneCount = doneCount,
            taskCount = tasks.size,
            tasks = chartTasks(),
            sticker = stickerDto(parent),
            closedOn = ChoreRules.closedOn(state, sticker?.chartDate, dueDate),
            createdAt = createdAt,
        )
    }
}

/** Reads of the `chore`, `chore_task` and live chore stickers. Every method uses a fixed number of queries. */
@Component
class ChoreQueries(private val jdbc: JdbcClient) {
    private data class Head(
        val id: Long,
        val childId: Long,
        val name: String,
        val iconKey: String,
        val dueDate: LocalDate?,
        val createdAt: Instant,
        val removed: Boolean,
    )

    private fun head(rs: ResultSet) = Head(
        rs.getLong("id"),
        rs.getLong("child_id"),
        rs.getString("name"),
        rs.getString("icon_key"),
        rs.getObject("due_date", LocalDate::class.java),
        rs.getObject("created_at", LocalDateTime::class.java).toInstant(ZoneOffset.UTC),
        rs.getObject("removed_at") != null,
    )

    /** The chores with these ids, removed ones included, ordered by `created_at` then `id`. Three queries. */
    fun load(ids: Collection<Long>): List<ChoreRecord> {
        if (ids.isEmpty()) return emptyList()
        val heads = jdbc.sql(
            "SELECT id, child_id, name, icon_key, due_date, created_at, removed_at FROM chore WHERE id IN (:ids) ORDER BY created_at, id",
        ).param("ids", ids).query { rs, _ -> head(rs) }.list()
        return assemble(heads)
    }

    fun loadOne(choreId: Long): ChoreRecord? = load(listOf(choreId)).firstOrNull()

    /** [heads] already in the order the caller wants. */
    private fun assemble(heads: List<Head>): List<ChoreRecord> {
        if (heads.isEmpty()) return emptyList()
        val ids = heads.map { it.id }
        val tasks = jdbc.sql(
            "SELECT id, chore_id, label, icon_key, checked_at FROM chore_task WHERE chore_id IN (:ids) ORDER BY chore_id, position, id",
        ).param("ids", ids).query { rs, _ ->
            rs.getLong("chore_id") to
                ChoreTaskRow(rs.getLong("id"), rs.getString("label"), rs.getString("icon_key"), rs.getObject("checked_at") != null)
        }.list().groupBy({ it.first }, { it.second })
        val stickers = jdbc.sql(
            "SELECT s.id, s.chore_id, s.chart_date, s.status, s.prize_request_id, s.finish_mode, " +
                "d.id AS design_id, d.name, d.artwork_key " +
                "FROM live_sticker s LEFT JOIN sticker_design d ON d.id = s.design_id WHERE s.chore_id IN (:ids)",
        ).param("ids", ids).query { rs, _ ->
            val designId = rs.getObject("design_id") as Number?
            rs.getLong("chore_id") to ChartStickerRow(
                stickerId = rs.getLong("id"),
                routineId = rs.getLong("chore_id"),
                chartDate = rs.getObject("chart_date", LocalDate::class.java),
                status = StickerStatus.valueOf(rs.getString("status")),
                design = designId?.let { DesignRefDto(it.toLong(), rs.getString("name"), rs.getString("artwork_key")) },
                prizeRequestId = (rs.getObject("prize_request_id") as Number?)?.toLong(),
                finishMode = rs.getString("finish_mode")?.let(FinishMode::valueOf),
            )
        }.list().toMap()
        return heads.map {
            ChoreRecord(
                it.id, it.childId, it.name, it.iconKey, it.dueDate, it.createdAt, it.removed, tasks[it.id].orEmpty(), stickers[it.id],
            )
        }
    }

    /** Chores of the child that may belong on a chart day in [from, to] (TDD 7.3). The reader narrows them down. */
    fun candidatesForChart(childId: Long, from: LocalDate, to: LocalDate, today: LocalDate): List<ChoreRecord> {
        val todayIn = today in from..to
        val heads = jdbc.sql(
            "SELECT c.id, c.child_id, c.name, c.icon_key, c.due_date, c.created_at, c.removed_at FROM chore c " +
                "WHERE c.child_id = :child AND c.removed_at IS NULL AND (" +
                // Finished: starts from the stickers dated in the range.
                "c.id IN (SELECT s.chore_id FROM live_sticker s WHERE s.child_id = :child AND s.chart_date BETWEEN :from AND :to) " +
                // Missed on a day in the range.
                "OR (c.due_date < :today AND c.due_date BETWEEN :from AND :to " +
                "AND NOT EXISTS (SELECT 1 FROM live_sticker s WHERE s.chore_id = c.id)) " +
                // Unfinished, listed on today only.
                "OR (:todayIn AND (c.due_date IS NULL OR c.due_date >= :today) " +
                "AND NOT EXISTS (SELECT 1 FROM live_sticker s WHERE s.chore_id = c.id))) " +
                "ORDER BY c.created_at, c.id",
        ).param("child", childId).param("from", from).param("to", to).param("today", today).param("todayIn", todayIn)
            .query { rs, _ -> head(rs) }.list()
        return assemble(heads)
    }

    /** Unfinished chores of the children (no live sticker, not past due), child by child in the given order. */
    fun unfinished(childIds: List<Long>, today: LocalDate): List<ChoreRecord> {
        if (childIds.isEmpty()) return emptyList()
        val heads = jdbc.sql(
            "SELECT c.id, c.child_id, c.name, c.icon_key, c.due_date, c.created_at, c.removed_at FROM chore c " +
                "WHERE c.child_id IN (:children) AND c.removed_at IS NULL AND (c.due_date IS NULL OR c.due_date >= :today) " +
                "AND NOT EXISTS (SELECT 1 FROM live_sticker s WHERE s.chore_id = c.id) ORDER BY c.created_at, c.id",
        ).param("children", childIds).param("today", today).query { rs, _ -> head(rs) }.list()
        val order = childIds.withIndex().associate { it.value to it.index }
        return assemble(heads.sortedBy { order.getValue(it.childId) })
    }

    /** One page of the closed list: finished chores and chores Missed since [cutoff], newest first by day closed. */
    fun closed(childIds: List<Long>, today: LocalDate, cutoff: LocalDate, after: ChoreCursor?, limit: Int): List<ChoreRecord> {
        if (childIds.isEmpty()) return emptyList()
        val closedOn = "COALESCE(s.chart_date, c.due_date)"
        val cursorSql = if (after == null) "" else "AND ($closedOn < :cursorDate OR ($closedOn = :cursorDate AND c.id < :cursorId)) "
        var spec = jdbc.sql(
            "SELECT c.id, c.child_id, c.name, c.icon_key, c.due_date, c.created_at, c.removed_at FROM chore c " +
                "LEFT JOIN live_sticker s ON s.chore_id = c.id " +
                "WHERE c.child_id IN (:children) AND c.removed_at IS NULL " +
                "AND (s.id IS NOT NULL OR (c.due_date < :today AND c.due_date >= :cutoff)) " + cursorSql +
                "ORDER BY $closedOn DESC, c.id DESC LIMIT :limit",
        ).param("children", childIds).param("today", today).param("cutoff", cutoff).param("limit", limit)
        if (after != null) spec = spec.param("cursorDate", after.closedOn).param("cursorId", after.id)
        val heads = spec.query { rs, _ -> head(rs) }.list()
        return assemble(heads)
    }

    fun unfinishedCount(childId: Long, today: LocalDate): Int = jdbc.sql(
        "SELECT COUNT(*) FROM chore c WHERE c.child_id = :child AND c.removed_at IS NULL " +
            "AND (c.due_date IS NULL OR c.due_date >= :today) " +
            "AND NOT EXISTS (SELECT 1 FROM live_sticker s WHERE s.chore_id = c.id)",
    ).param("child", childId).param("today", today).query(Int::class.java).single()

    /** The owning child, removed chores included, or null when there is no such chore. */
    fun childIdOf(choreId: Long): Long? =
        jdbc.sql("SELECT child_id FROM chore WHERE id = ?").param(choreId).query(Long::class.java).list().firstOrNull()

    /** The family's children in display order. */
    fun childIds(): List<Long> =
        jdbc.sql("SELECT id FROM child WHERE archived_at IS NULL ORDER BY position, id").query(Long::class.java).list().filterNotNull()

    fun childExists(childId: Long): Boolean =
        jdbc.sql("SELECT COUNT(*) FROM child WHERE id = ?").param(childId).query(Long::class.java).single() > 0

    /** The latest chore of each distinct name, newest first, removed ones included (FR-13.8). Three queries at most. */
    fun recent(limit: Int): List<ChoreRecord> {
        val ids = jdbc.sql(
            "SELECT id FROM (SELECT id, created_at, " +
                "ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at DESC, id DESC) AS rn FROM chore) x " +
                "WHERE rn = 1 ORDER BY created_at DESC, id DESC LIMIT :limit",
        ).param("limit", limit).query(Long::class.java).list().filterNotNull()
        val byId = load(ids).associateBy { it.choreId }
        return ids.mapNotNull { byId[it] }
    }
}

/** Opaque keyset cursor of the closed list: base64url of the last row's `closedOn` and id. */
data class ChoreCursor(val closedOn: LocalDate, val id: Long) {
    fun encode(): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("$closedOn|$id".toByteArray(Charsets.UTF_8))

    companion object {
        /** Returns null when the cursor is malformed. */
        fun decode(raw: String): ChoreCursor? = try {
            val parts = String(java.util.Base64.getUrlDecoder().decode(raw), Charsets.UTF_8).split("|")
            if (parts.size != 2) null else ChoreCursor(LocalDate.parse(parts[0]), parts[1].toLong())
        } catch (_: RuntimeException) {
            null
        }
    }
}
