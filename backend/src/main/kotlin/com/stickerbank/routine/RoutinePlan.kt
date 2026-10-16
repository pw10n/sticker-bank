package com.stickerbank.routine

import com.stickerbank.common.FamilyClock
import com.stickerbank.common.Weekdays
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.time.LocalDate

data class PlannedTask(val taskId: Long, val position: Int, val label: String, val iconKey: String)

data class PlannedRoutine(
    val routineId: Long,
    val childId: Long,
    /** Current routine.position (I-6, not versioned). */
    val position: Int,
    val revisionId: Long,
    val effectiveFrom: LocalDate,
    val name: String,
    val iconKey: String,
    val color: String?,
    /** Ordered by position; never empty. */
    val tasks: List<PlannedTask>,
    val skipped: Boolean,
)

/** One stored revision of a routine together with its ordered tasks (loaded form, input of [RevisionEvaluator]). */
data class RevisionRecord(
    val routineId: Long,
    val childId: Long,
    val routinePosition: Int,
    val revisionId: Long,
    val effectiveFrom: LocalDate,
    val name: String,
    val iconKey: String,
    val color: String?,
    val daysMask: Int,
    val paused: Boolean,
    val deleted: Boolean,
    val tasks: List<PlannedTask>,
)

/** Pure evaluation of the revision model (TDD 6.4): the definition for day D is the revision with the latest effective_from <= D. */
object RevisionEvaluator {
    /** The revision in force on [date] for one routine, or null when there is none yet. */
    fun inForce(revisions: List<RevisionRecord>, date: LocalDate): RevisionRecord? =
        revisions.filter { !it.effectiveFrom.isAfter(date) }.maxByOrNull { it.effectiveFrom }

    /** The routine as planned for [date], or null when it does not appear on a chart that day. */
    fun plannedFor(revisions: List<RevisionRecord>, date: LocalDate, skipDates: Set<LocalDate>): PlannedRoutine? {
        val rev = inForce(revisions, date) ?: return null
        if (rev.deleted || rev.paused || !Weekdays.includes(rev.daysMask, date) || rev.tasks.isEmpty()) return null
        return PlannedRoutine(
            routineId = rev.routineId,
            childId = rev.childId,
            position = rev.routinePosition,
            revisionId = rev.revisionId,
            effectiveFrom = rev.effectiveFrom,
            name = rev.name,
            iconKey = rev.iconKey,
            color = rev.color,
            tasks = rev.tasks.sortedBy { it.position },
            skipped = date in skipDates,
        )
    }

    /** All routines on the chart for [date], ordered by routine position then id. [skips] holds (routineId, date) pairs. */
    fun plan(
        revisionsByRoutine: Map<Long, List<RevisionRecord>>,
        skips: Set<Pair<Long, LocalDate>>,
        date: LocalDate,
    ): List<PlannedRoutine> = revisionsByRoutine.mapNotNull { (routineId, revisions) ->
        plannedFor(revisions, date, skips.filter { it.first == routineId }.map { it.second }.toSet())
    }.sortedWith(compareBy({ it.position }, { it.routineId }))
}

@Component
class RoutinePlanQuery(private val jdbc: JdbcClient) {
    /** Routines on the child's chart for [date], ordered by routine.position, routine.id. Includes skipped ones (skipped=true). */
    fun planFor(childId: Long, date: LocalDate): List<PlannedRoutine> = planForRange(childId, date, date).getValue(date)

    /** Same evaluation for every date in [from, to] (inclusive), loading revisions/tasks/skips once. Every date is a key. */
    fun planForRange(childId: Long, from: LocalDate, to: LocalDate): Map<LocalDate, List<PlannedRoutine>> {
        val byRoutine = loadRevisions("r.child_id = :childId", mapOf("childId" to childId), to)
        val skips =
            jdbc.sql(
                "SELECT s.routine_id, s.chart_date FROM routine_skip s JOIN routine r ON r.id = s.routine_id " +
                    "WHERE r.child_id = :childId AND s.chart_date BETWEEN :from AND :to",
            ).param("childId", childId).param("from", from).param("to", to)
                .query { rs, _ -> rs.getLong("routine_id") to rs.getObject("chart_date", LocalDate::class.java) }
                .list().toSet()
        val skipsByRoutine = skips.groupBy({ it.first }, { it.second }).mapValues { it.value.toSet() }
        val result = LinkedHashMap<LocalDate, List<PlannedRoutine>>()
        var day = from
        while (!day.isAfter(to)) {
            result[day] =
                byRoutine.mapNotNull { (routineId, revisions) ->
                    RevisionEvaluator.plannedFor(revisions, day, skipsByRoutine[routineId].orEmpty())
                }.sortedWith(compareBy({ it.position }, { it.routineId }))
            day = day.plusDays(1)
        }
        return result
    }

    /** The routine as planned for [date], or null if it has no revision then, is deleted/paused, is off that weekday, or has no tasks. */
    fun plannedRoutine(routineId: Long, date: LocalDate): PlannedRoutine? {
        val revisions = loadRevisions("r.id = :routineId", mapOf("routineId" to routineId), date)[routineId] ?: return null
        val skipped =
            jdbc.sql("SELECT COUNT(*) FROM routine_skip WHERE routine_id = ? AND chart_date = ?")
                .param(routineId).param(date).query(Long::class.java).single() > 0
        return RevisionEvaluator.plannedFor(revisions, date, if (skipped) setOf(date) else emptySet())
    }

    private fun loadRevisions(where: String, params: Map<String, Any>, upTo: LocalDate): Map<Long, List<RevisionRecord>> {
        val rows =
            jdbc.sql(
                "SELECT rr.id, rr.routine_id, r.child_id, r.position, rr.effective_from, rr.name, rr.icon_key, rr.color, " +
                    "rr.days_mask, rr.paused, rr.deleted FROM routine_revision rr JOIN routine r ON r.id = rr.routine_id " +
                    "WHERE $where AND rr.effective_from <= :upTo ORDER BY rr.routine_id, rr.effective_from",
            ).params(params).param("upTo", upTo).query { rs, _ -> revisionRow(rs) }.list()
        if (rows.isEmpty()) return emptyMap()
        val tasksByRevision =
            jdbc.sql(
                "SELECT rt.revision_id, rt.task_id, rt.position, rt.label, rt.icon_key FROM revision_task rt " +
                    "JOIN routine_revision rr ON rr.id = rt.revision_id JOIN routine r ON r.id = rr.routine_id " +
                    "WHERE $where AND rr.effective_from <= :upTo ORDER BY rt.revision_id, rt.position",
            ).params(params).param("upTo", upTo)
                .query { rs, _ ->
                    rs.getLong("revision_id") to
                        PlannedTask(rs.getLong("task_id"), rs.getInt("position"), rs.getString("label"), rs.getString("icon_key"))
                }.list().groupBy({ it.first }, { it.second })
        return rows.map { it.copy(tasks = tasksByRevision[it.revisionId].orEmpty()) }.groupBy { it.routineId }
    }

    private fun revisionRow(rs: ResultSet) = RevisionRecord(
        routineId = rs.getLong("routine_id"),
        childId = rs.getLong("child_id"),
        routinePosition = rs.getInt("position"),
        revisionId = rs.getLong("id"),
        effectiveFrom = rs.getObject("effective_from", LocalDate::class.java),
        name = rs.getString("name"),
        iconKey = rs.getString("icon_key"),
        color = rs.getString("color"),
        daysMask = rs.getInt("days_mask"),
        paused = rs.getBoolean("paused"),
        deleted = rs.getBoolean("deleted"),
        tasks = emptyList(),
    )
}

@Component
class RevisionPolicy(private val clock: FamilyClock, private val jdbc: JdbcClient) {
    /** E = today + 1 if a live sticker exists for (routine, today), else today. */
    fun effectiveDateForEdit(routineId: Long): LocalDate {
        val today = clock.today()
        val exists =
            jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ? AND chart_date = ?")
                .param(routineId).param(today).query(Long::class.java).single() > 0
        return effectiveDate(today, exists)
    }

    companion object {
        fun effectiveDate(today: LocalDate, stickerExistsToday: Boolean): LocalDate = if (stickerExistsToday) today.plusDays(1) else today
    }
}
