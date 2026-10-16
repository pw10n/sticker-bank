package com.stickerbank.chart

import com.stickerbank.common.Actor
import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.revocation.RevocationService
import com.stickerbank.routine.PlannedRoutine
import com.stickerbank.routine.RoutinePlanQuery
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Task toggling and finishing (TDD 7.4). Everything runs under the child lock so a routine earns at most one sticker.
 * Completing the last task never earns anything (FR-7.1, BR-18): the routine becomes READY_TO_FINISH, and only
 * [finish] (I'm Done!) or day settlement (TDD 7.12) earns the sticker.
 */
@Service
class CompletionService(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val plans: RoutinePlanQuery,
    private val queries: ChartQueries,
    private val earner: StickerEarner,
    private val clock: FamilyClock,
    private val revocations: RevocationService,
    private val settlement: DaySettlement,
) {
    private val log = LoggerFactory.getLogger(CompletionService::class.java)

    fun complete(childId: Long, rawDate: String, taskId: Long, actor: Actor): TaskToggleResultDto {
        val (date, today) = checkDate(rawDate, actor)
        return childLock.withChildLock(childId) {
            settlement.settleLocked(childId)
            val planned = resolve(childId, date, taskId)
            if (queries.stickers(childId, date, date)[planned.routineId to date] == null) {
                jdbc.sql(
                    "INSERT INTO task_completion (task_id, chart_date, routine_id, child_id, completed_at, completed_by) " +
                        "VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE task_id = task_id",
                ).params(taskId, date, planned.routineId, childId, LocalDateTime.ofInstant(clock.now(), ZoneOffset.UTC), actor.name)
                    .update()
            }
            TaskToggleResultDto(view(childId, planned, date, today, actor), null, null)
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
            settlement.settleLocked(childId)
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
            // No sticker yet, including a routine that is only Ready to finish: a plain undo (FR-6.7, BR-19).
            jdbc.sql("DELETE FROM task_completion WHERE task_id = ? AND chart_date = ?").params(taskId, date).update()
            TaskToggleResultDto(view(childId, planned, date, today, actor), null, null)
        }
    }

    /**
     * I'm Done! (FR-6.8): finishes a routine whose tasks are all done and earns its sticker. Idempotent: when the
     * sticker already exists the routine is returned unchanged, with the saved choices while it is still UNCLAIMED.
     */
    fun finish(childId: Long, rawDate: String, routineId: Long, actor: Actor): TaskToggleResultDto {
        val (date, today) = checkDate(rawDate, actor)
        return childLock.withChildLock(childId) {
            settlement.settleLocked(childId)
            val planned = resolveRoutine(childId, date, routineId)
            val existing = queries.stickers(childId, date, date)[routineId to date]
            if (existing != null) {
                val pick = if (existing.status == StickerStatus.UNCLAIMED) earner.getPick(existing.stickerId) else null
                return@withChildLock TaskToggleResultDto(view(childId, planned, date, today, actor), pick, null)
            }
            val completed = queries.completions(childId, date, date)[date].orEmpty()
            if (!planned.tasks.all { it.taskId in completed }) throw DomainException(ErrorCode.ROUTINE_NOT_READY)
            val pick: StickerPickDto = earner.earn(childId, routineId, date, planned.name, planned.iconKey, FinishMode.TAPPED)
            log.info("routine finished childId={} routineId={} date={} stickerId={}", childId, routineId, date, pick.stickerId)
            TaskToggleResultDto(view(childId, planned, date, today, actor), pick, null)
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
        val planned = scheduled(routineId, date)
        if (planned.tasks.none { it.taskId == taskId }) throw DomainException(ErrorCode.ROUTINE_NOT_SCHEDULED)
        return planned
    }

    private fun resolveRoutine(childId: Long, date: LocalDate, routineId: Long): PlannedRoutine {
        val owned =
            jdbc.sql("SELECT COUNT(*) FROM routine WHERE id = ? AND child_id = ?").params(routineId, childId)
                .query(Long::class.java).single() > 0
        if (!owned) throw DomainException(ErrorCode.NOT_FOUND, "Routine not found")
        return scheduled(routineId, date)
    }

    /** The routine as planned for [date]; it must be on the chart and not skipped that day. */
    private fun scheduled(routineId: Long, date: LocalDate): PlannedRoutine {
        val planned = plans.plannedRoutine(routineId, date)
        if (planned == null || planned.skipped) throw DomainException(ErrorCode.ROUTINE_NOT_SCHEDULED)
        return planned
    }

    private fun view(childId: Long, planned: PlannedRoutine, date: LocalDate, today: LocalDate, actor: Actor): ChartRoutineDto {
        val completed = queries.completions(childId, date, date)[date].orEmpty()
        val sticker = queries.stickers(childId, date, date)[planned.routineId to date]
        return ChartQueries.routineDto(planned, date, today, completed, sticker, actor == Actor.PARENT)
    }
}
