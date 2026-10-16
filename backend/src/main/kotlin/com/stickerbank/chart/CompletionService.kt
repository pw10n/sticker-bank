package com.stickerbank.chart

import com.stickerbank.common.Actor
import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.revocation.RevocationService
import com.stickerbank.routine.PlannedRoutine
import com.stickerbank.routine.RoutinePlanQuery
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/** Task toggling (TDD 7.4). Everything runs under the child lock so a routine earns at most one sticker. */
@Service
class CompletionService(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val plans: RoutinePlanQuery,
    private val queries: ChartQueries,
    private val earner: StickerEarner,
    private val clock: FamilyClock,
    private val revocations: RevocationService,
) {
    private val log = LoggerFactory.getLogger(CompletionService::class.java)

    fun complete(childId: Long, rawDate: String, taskId: Long, actor: Actor): TaskToggleResultDto {
        val (date, today) = checkDate(rawDate, actor)
        return childLock.withChildLock(childId) {
            val planned = resolve(childId, date, taskId)
            if (queries.stickers(childId, date, date)[planned.routineId to date] != null) {
                return@withChildLock TaskToggleResultDto(view(childId, planned, date, today, actor), null, null)
            }
            jdbc.sql(
                "INSERT INTO task_completion (task_id, chart_date, routine_id, child_id, completed_at, completed_by) " +
                    "VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE task_id = task_id",
            ).params(taskId, date, planned.routineId, childId, LocalDateTime.ofInstant(clock.now(), ZoneOffset.UTC), actor.name).update()
            val completed = queries.completions(childId, date, date)[date].orEmpty()
            val pick: StickerPickDto? =
                if (planned.tasks.all { it.taskId in completed }) {
                    earner.earn(childId, planned.routineId, date, planned.name, planned.iconKey).also {
                        log.info(
                            "sticker earned childId={} routineId={} date={} stickerId={}",
                            childId,
                            planned.routineId,
                            date,
                            it.stickerId,
                        )
                    }
                } else {
                    null
                }
            TaskToggleResultDto(view(childId, planned, date, today, actor), pick, null)
        }
    }

    fun undo(
        childId: Long,
        rawDate: String,
        taskId: Long,
        actor: Actor,
        revokeSticker: Boolean = false,
        note: String? = null,
    ): TaskToggleResultDto {
        val (date, today) = checkDate(rawDate, actor)
        return childLock.withChildLock(childId) {
            val planned = resolve(childId, date, taskId)
            val sticker = queries.stickers(childId, date, date)[planned.routineId to date]
            if (sticker != null) {
                if (actor != Actor.PARENT) throw DomainException(ErrorCode.ROUTINE_LOCKED)
                if (!revokeSticker) {
                    throw DomainException(
                        ErrorCode.REVOKE_CONFIRMATION_REQUIRED,
                        properties = mapOf("sticker" to ChartQueries.stickerDto(sticker, parent = true)),
                    )
                }
                return@withChildLock revocations.revokeLocked(childId, planned.routineId, planned, date, taskId, note)
            }
            jdbc.sql("DELETE FROM task_completion WHERE task_id = ? AND chart_date = ?").params(taskId, date).update()
            TaskToggleResultDto(view(childId, planned, date, today, actor), null, null)
        }
    }

    private fun checkDate(rawDate: String, actor: Actor): Pair<LocalDate, LocalDate> {
        val today = clock.today()
        val date = ChartRules.parsePastOrToday(rawDate, today)
        if (date.isBefore(today) && actor == Actor.CHILD) {
            throw DomainException(ErrorCode.DAY_CHANGED, properties = mapOf("today" to today.toString()))
        }
        return date to today
    }

    private fun resolve(childId: Long, date: LocalDate, taskId: Long): PlannedRoutine {
        val routineId =
            jdbc.sql("SELECT t.routine_id FROM task t JOIN routine r ON r.id = t.routine_id WHERE t.id = ? AND r.child_id = ?")
                .params(taskId, childId).query(Long::class.java).list().firstOrNull()
                ?: throw DomainException(ErrorCode.NOT_FOUND, "Task not found")
        val planned = plans.plannedRoutine(routineId, date)
        if (planned == null || planned.skipped || planned.tasks.none { it.taskId == taskId }) {
            throw DomainException(ErrorCode.ROUTINE_NOT_SCHEDULED)
        }
        return planned
    }

    private fun view(childId: Long, planned: PlannedRoutine, date: LocalDate, today: LocalDate, actor: Actor): ChartRoutineDto {
        val completed = queries.completions(childId, date, date)[date].orEmpty()
        val sticker = queries.stickers(childId, date, date)[planned.routineId to date]
        return ChartQueries.routineDto(planned, date, today, completed, sticker, actor == Actor.PARENT)
    }
}
