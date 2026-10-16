package com.stickerbank.routine

import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.Weekdays
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.LocalDateTime

/** A stored revision row without its tasks. */
private data class RevisionRow(
    val id: Long,
    val effectiveFrom: LocalDate,
    val name: String,
    val iconKey: String,
    val color: String?,
    val daysMask: Int,
    val paused: Boolean,
    val deleted: Boolean,
)

/** What gets written into a revision; tasks are (taskId, label, iconKey) in display order. */
private data class RevisionWrite(
    val name: String,
    val iconKey: String,
    val color: String?,
    val daysMask: Int,
    val paused: Boolean,
    val deleted: Boolean,
    val tasks: List<Triple<Long, String, String>>,
)

private data class SaveOutcome(val today: LocalDate, val effective: LocalDate, val earned: StickerPickDto?)

@Service
class RoutineService(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val validator: RoutineInputValidator,
    private val policy: RevisionPolicy,
    private val planQuery: RoutinePlanQuery,
    private val earner: StickerEarner,
    private val familyClock: FamilyClock,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(RoutineService::class.java)

    // ---- reads ----

    fun list(childId: Long): List<RoutineDto> {
        val exists = jdbc.sql("SELECT COUNT(*) FROM child WHERE id = ?").param(childId).query(Long::class.java).single() > 0
        if (!exists) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
        return dtos("r.child_id = :scope", childId)
    }

    fun get(routineId: Long): RoutineDto {
        activeChildId(routineId)
        return dtos("r.id = :scope", routineId).firstOrNull() ?: throw notFound()
    }

    // ---- writes ----

    fun create(childId: Long, input: RoutineInput): RoutineSaveResultDto {
        val valid = validator.validate(input, creating = true)
        val today = familyClock.today()
        val routineId =
            childLock.withChildLock(childId) {
                val id = insertRoutine(childId)
                val tasks = valid.tasks.map { Triple(insertTask(id), it.label, it.iconKey) }
                writeRevision(
                    id,
                    today,
                    RevisionWrite(valid.name, valid.iconKey, valid.color, valid.daysMask ?: Weekdays.ALL, valid.paused, false, tasks),
                )
                id
            }
        log.info("Created routine {} for child {}", routineId, childId)
        return RoutineSaveResultDto(get(routineId), today, appliesFromTomorrow = false, earnedPick = null)
    }

    fun update(routineId: Long, input: RoutineInput): RoutineSaveResultDto {
        val childId = activeChildId(routineId)
        val valid = validator.validate(input, creating = false)
        val saved =
            childLock.withChildLock(childId) {
                activeChildId(routineId)
                checkTaskOwnership(routineId, valid)
                val today = familyClock.today()
                val effective = policy.effectiveDateForEdit(routineId)
                val latest = latestRevision(routineId)
                val tasks = valid.tasks.map { Triple(it.id ?: insertTask(routineId), it.label, it.iconKey) }
                val mask = valid.daysMask ?: latest?.daysMask ?: Weekdays.ALL
                writeRevision(routineId, effective, RevisionWrite(valid.name, valid.iconKey, valid.color, mask, valid.paused, false, tasks))
                SaveOutcome(today, effective, if (effective == today) earnIfComplete(childId, routineId, today) else null)
            }
        log.info("Saved routine {} effective {}", routineId, saved.effective)
        return RoutineSaveResultDto(get(routineId), saved.effective, saved.effective == saved.today.plusDays(1), saved.earned)
    }

    fun delete(routineId: Long): RoutineDeleteResultDto {
        val childId = activeChildId(routineId)
        val effective =
            childLock.withChildLock(childId) {
                activeChildId(routineId)
                val e = policy.effectiveDateForEdit(routineId)
                val inForce = revisionInForce(routineId, e)
                val write =
                    if (inForce == null) {
                        RevisionWrite("Routine", "", null, Weekdays.ALL, false, true, emptyList())
                    } else {
                        RevisionWrite(
                            inForce.name,
                            inForce.iconKey,
                            inForce.color,
                            inForce.daysMask,
                            inForce.paused,
                            true,
                            revisionTasks(inForce.id),
                        )
                    }
                writeRevision(routineId, e, write)
                // a pending later revision must not resurrect the routine
                jdbc.sql("UPDATE routine_revision SET deleted = TRUE WHERE routine_id = ? AND effective_from > ?")
                    .params(routineId, e).update()
                jdbc.sql("UPDATE routine SET deleted_at = ? WHERE id = ?").params(now(), routineId).update()
                e
            }
        log.info("Deleted routine {} effective {}", routineId, effective)
        return RoutineDeleteResultDto(routineId, effective)
    }

    fun reorder(childId: Long, request: RoutineOrderRequest) {
        childLock.withChildLock(childId) {
            val current =
                jdbc.sql("SELECT id FROM routine WHERE child_id = ? AND deleted_at IS NULL").param(childId)
                    .query(Long::class.java).list().toSet()
            val ids = request.routineIds
            if (ids.size != ids.toSet().size || ids.toSet() != current) {
                throw RoutineInputValidator.fieldFailure(
                    listOf(FieldErrorDto("routineIds", "List every routine of this child exactly once")),
                )
            }
            if (ids.isNotEmpty()) {
                val cases = ids.indices.joinToString(" ") { "WHEN ? THEN ?" }
                val params = ids.flatMapIndexed { index, id -> listOf(id, index + 1) } + childId
                jdbc.sql("UPDATE routine SET position = CASE id $cases END WHERE child_id = ? AND deleted_at IS NULL")
                    .params(params).update()
            }
        }
        log.info("Reordered routines of child {}", childId)
    }

    fun copy(routineId: Long, request: RoutineCopyRequest): RoutineDto {
        activeChildId(routineId)
        val newId =
            childLock.withChildLock(request.targetChildId) {
                val source = latestRevision(routineId) ?: throw notFound()
                val sourceTasks = revisionTasks(source.id)
                val id = insertRoutine(request.targetChildId)
                val tasks = sourceTasks.map { Triple(insertTask(id), it.second, it.third) }
                writeRevision(
                    id,
                    familyClock.today(),
                    RevisionWrite(source.name, source.iconKey, source.color, source.daysMask, source.paused, false, tasks),
                )
                id
            }
        log.info("Copied routine {} to routine {} for child {}", routineId, newId, request.targetChildId)
        return get(newId)
    }

    fun skip(routineId: Long, date: LocalDate) {
        val childId = activeChildId(routineId)
        childLock.withChildLock(childId) {
            val earned =
                jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ? AND chart_date = ?").params(routineId, date)
                    .query(Long::class.java).single() > 0
            if (earned) throw DomainException(ErrorCode.ROUTINE_LOCKED)
            jdbc.sql(
                "INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, ?) " +
                    "ON DUPLICATE KEY UPDATE routine_id = routine_id",
            ).params(routineId, date, now()).update()
        }
        log.info("Skipped routine {} on {}", routineId, date)
    }

    fun unskip(routineId: Long, date: LocalDate) {
        val childId = activeChildId(routineId)
        childLock.withChildLock(childId) {
            jdbc.sql("DELETE FROM routine_skip WHERE routine_id = ? AND chart_date = ?").params(routineId, date).update()
        }
        log.info("Unskipped routine {} on {}", routineId, date)
    }

    // ---- internals ----

    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), java.time.ZoneOffset.UTC)

    private fun notFound() = DomainException(ErrorCode.NOT_FOUND, "Routine not found")

    private fun activeChildId(routineId: Long): Long =
        jdbc.sql("SELECT child_id FROM routine WHERE id = ? AND deleted_at IS NULL").param(routineId)
            .query(Long::class.java).list().firstOrNull() ?: throw notFound()

    private fun insertRoutine(childId: Long): Long {
        val position =
            jdbc.sql("SELECT COALESCE(MAX(position), 0) + 1 FROM routine WHERE child_id = ?").param(childId)
                .query(Int::class.java).single()
        return insertReturningKey("INSERT INTO routine (child_id, position, created_at) VALUES (?, ?, ?)", childId, position, now())
    }

    private fun insertTask(routineId: Long): Long =
        insertReturningKey("INSERT INTO task (routine_id, created_at) VALUES (?, ?)", routineId, now())

    private fun insertReturningKey(sql: String, vararg params: Any?): Long {
        val keys = GeneratedKeyHolder()
        jdbc.sql(sql).params(params.toList()).update(keys)
        return requireNotNull(keys.key).toLong()
    }

    private fun checkTaskOwnership(routineId: Long, valid: ValidRoutine) {
        val wanted = valid.tasks.mapNotNull { it.id }
        if (wanted.isEmpty()) return
        val owned =
            jdbc.sql("SELECT id FROM task WHERE routine_id = :routineId AND id IN (:ids)")
                .param("routineId", routineId).param("ids", wanted).query(Long::class.java).list().toSet()
        val errors =
            valid.tasks.mapIndexedNotNull { index, task ->
                if (task.id != null && task.id !in owned) FieldErrorDto("tasks[$index].id", "Unknown task") else null
            }
        if (errors.isNotEmpty()) throw RoutineInputValidator.fieldFailure(errors)
    }

    /** Upserts the revision at [effectiveFrom]: repeated edits on one day overwrite a single row. */
    private fun writeRevision(routineId: Long, effectiveFrom: LocalDate, write: RevisionWrite): Long {
        val existing =
            jdbc.sql("SELECT id FROM routine_revision WHERE routine_id = ? AND effective_from = ?")
                .params(routineId, effectiveFrom).query(Long::class.java).list().firstOrNull()
        val revisionId =
            if (existing != null) {
                jdbc.sql(
                    "UPDATE routine_revision SET name = ?, icon_key = ?, color = ?, days_mask = ?, paused = ?, deleted = ?, " +
                        "updated_at = ? WHERE id = ?",
                ).params(
                    listOf<Any?>(write.name, write.iconKey, write.color, write.daysMask, write.paused, write.deleted, now(), existing),
                ).update()
                jdbc.sql("DELETE FROM revision_task WHERE revision_id = ?").param(existing).update()
                existing
            } else {
                insertReturningKey(
                    "INSERT INTO routine_revision (routine_id, effective_from, name, icon_key, color, days_mask, paused, deleted, " +
                        "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    routineId, effectiveFrom, write.name, write.iconKey, write.color, write.daysMask, write.paused, write.deleted, now(),
                )
            }
        write.tasks.forEachIndexed { index, (taskId, label, iconKey) ->
            jdbc.sql("INSERT INTO revision_task (revision_id, task_id, position, label, icon_key) VALUES (?, ?, ?, ?, ?)")
                .params(revisionId, taskId, index + 1, label, iconKey).update()
        }
        return revisionId
    }

    private fun latestRevision(routineId: Long): RevisionRow? = queryRevision(
        "WHERE routine_id = ? ORDER BY effective_from DESC LIMIT 1",
        routineId,
    )

    private fun revisionInForce(routineId: Long, date: LocalDate): RevisionRow? = queryRevision(
        "WHERE routine_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1",
        routineId,
        date,
    )

    private fun queryRevision(tail: String, vararg params: Any?): RevisionRow? =
        jdbc.sql("SELECT id, effective_from, name, icon_key, color, days_mask, paused, deleted FROM routine_revision $tail")
            .params(params.toList())
            .query { rs, _ ->
                RevisionRow(
                    rs.getLong("id"),
                    rs.getObject("effective_from", LocalDate::class.java),
                    rs.getString("name"),
                    rs.getString("icon_key"),
                    rs.getString("color"),
                    rs.getInt("days_mask"),
                    rs.getBoolean("paused"),
                    rs.getBoolean("deleted"),
                )
            }.list().firstOrNull()

    /** (taskId, label, iconKey) in display order. */
    private fun revisionTasks(revisionId: Long): List<Triple<Long, String, String>> =
        jdbc.sql("SELECT task_id, label, icon_key FROM revision_task WHERE revision_id = ? ORDER BY position")
            .param(revisionId)
            .query { rs, _ -> Triple(rs.getLong("task_id"), rs.getString("label"), rs.getString("icon_key")) }.list()

    /** I-3: the edit removed the last unfinished task, so the sticker is earned now. Runs inside the child lock. */
    private fun earnIfComplete(childId: Long, routineId: Long, today: LocalDate): StickerPickDto? {
        val planned = planQuery.plannedRoutine(routineId, today)
        if (planned == null || planned.skipped) return null
        val done =
            jdbc.sql("SELECT task_id FROM task_completion WHERE routine_id = ? AND chart_date = ?").params(routineId, today)
                .query(Long::class.java).list().toSet()
        if (!planned.tasks.all { it.taskId in done }) return null
        val hasLive =
            jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ? AND chart_date = ?").params(routineId, today)
                .query(Long::class.java).single() > 0
        if (hasLive) return null
        return earner.earn(childId, routineId, today, planned.name, planned.iconKey)
    }

    private fun dtos(where: String, scope: Long): List<RoutineDto> {
        val today = familyClock.today()
        data class Head(val id: Long, val childId: Long, val position: Int, val revision: RevisionRow)
        val heads =
            jdbc.sql(
                "SELECT * FROM (SELECT r.id AS routine_id, r.child_id, r.position, rr.id, rr.effective_from, rr.name, rr.icon_key, " +
                    "rr.color, rr.days_mask, rr.paused, rr.deleted, " +
                    "ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY rr.effective_from DESC) AS rn " +
                    "FROM routine r JOIN routine_revision rr ON rr.routine_id = r.id WHERE r.deleted_at IS NULL AND $where) x " +
                    "WHERE rn = 1 ORDER BY position, routine_id",
            ).param("scope", scope).query { rs, _ ->
                Head(
                    rs.getLong("routine_id"),
                    rs.getLong("child_id"),
                    rs.getInt("position"),
                    RevisionRow(
                        rs.getLong("id"),
                        rs.getObject("effective_from", LocalDate::class.java),
                        rs.getString("name"),
                        rs.getString("icon_key"),
                        rs.getString("color"),
                        rs.getInt("days_mask"),
                        rs.getBoolean("paused"),
                        rs.getBoolean("deleted"),
                    ),
                )
            }.list()
        if (heads.isEmpty()) return emptyList()
        val tasks =
            jdbc.sql(
                "SELECT revision_id, task_id, label, icon_key, position FROM revision_task " +
                    "WHERE revision_id IN (:ids) ORDER BY revision_id, position",
            )
                .param("ids", heads.map { it.revision.id })
                .query { rs, _ ->
                    rs.getLong("revision_id") to
                        TaskDto(rs.getLong("task_id"), rs.getString("label"), rs.getString("icon_key"), rs.getInt("position"))
                }.list().groupBy({ it.first }, { it.second })
        val skips =
            jdbc.sql(
                "SELECT routine_id, chart_date FROM routine_skip WHERE routine_id IN (:ids) AND chart_date >= :today ORDER BY chart_date",
            )
                .param("ids", heads.map { it.id }).param("today", today)
                .query { rs, _ -> rs.getLong("routine_id") to rs.getObject("chart_date", LocalDate::class.java) }
                .list().groupBy({ it.first }, { it.second })
        return heads.map { h ->
            RoutineDto(
                id = h.id, childId = h.childId, position = h.position, name = h.revision.name, iconKey = h.revision.iconKey,
                color = h.revision.color, days = Weekdays.fromMask(h.revision.daysMask), paused = h.revision.paused,
                effectiveFrom = h.revision.effectiveFrom, tasks = tasks[h.revision.id].orEmpty(),
                upcomingSkips = skips[h.id].orEmpty(),
            )
        }
    }
}
