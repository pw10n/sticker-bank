package com.stickerbank.chore

import com.stickerbank.chart.ChartQueries
import com.stickerbank.chart.DaySettlement
import com.stickerbank.common.Actor
import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.EarnSource
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.StickerStatus
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * The chore lifecycle (TDD 7.13). Every write runs under the child lock and settles ended days first, and reads `today`
 * after that, inside the lock. Nothing but [finish] and an assign with `alreadyDone` earns a sticker, so a chore never
 * earns two (BR-20).
 */
@Service
class JdbcChoreService(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val queries: ChoreQueries,
    private val validator: ChoreInputValidator,
    private val settlement: DaySettlement,
    private val earner: StickerEarner,
    private val revoker: ChoreRevoker,
    private val clock: FamilyClock,
) : ChoreService {
    private val log = LoggerFactory.getLogger(JdbcChoreService::class.java)

    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.now(), ZoneOffset.UTC)

    override fun assign(childId: Long, input: ChoreInput): ChoreDto = childLock.withChildLock(childId) {
        settlement.settleLocked(childId)
        val today = clock.today()
        val valid = validator.validate(input, today, creating = true)
        if (!valid.alreadyDone && ChoreRules.limitReached(queries.unfinishedCount(childId, today))) {
            throw DomainException(ErrorCode.CHORE_LIMIT_REACHED)
        }
        val now = now()
        val choreId = insertChore(childId, valid, now)
        valid.tasks.forEachIndexed { index, task ->
            jdbc.sql(
                "INSERT INTO chore_task (chore_id, position, label, icon_key, checked_at, checked_by) VALUES (?, ?, ?, ?, ?, ?)",
            ).params(
                listOf(
                    choreId,
                    index + 1,
                    task.label,
                    task.iconKey,
                    if (valid.alreadyDone) now else null,
                    if (valid.alreadyDone) Actor.PARENT.name else null,
                ),
            )
                .update()
        }
        if (valid.alreadyDone) earner.earn(childId, EarnSource.Chore(choreId), today, valid.name, valid.iconKey, FinishMode.TAPPED)
        log.info("chore assigned childId={} choreId={} alreadyDone={}", childId, choreId, valid.alreadyDone)
        requireNotNull(queries.loadOne(choreId)).toDto(today, parent = true)
    }

    private fun insertChore(childId: Long, valid: ValidChore, now: LocalDateTime): Long {
        val keys = org.springframework.jdbc.support.GeneratedKeyHolder()
        jdbc.sql("INSERT INTO chore (child_id, name, icon_key, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .params(listOf(childId, valid.name, valid.iconKey, valid.dueDate, now, now)).update(keys)
        return requireNotNull(keys.key).toLong()
    }

    override fun save(choreId: Long, input: ChoreInput): ChoreDto {
        val childId = queries.childIdOf(choreId) ?: throw notFound()
        return childLock.withChildLock(childId) {
            settlement.settleLocked(childId)
            val today = clock.today()
            val chore = queries.loadOne(choreId)?.takeIf { !it.removed } ?: throw notFound()
            if (chore.sticker != null) throw DomainException(ErrorCode.CHORE_LOCKED)
            val valid = validator.validate(input, today, creating = false, ownTaskIds = chore.tasks.map { it.taskId }.toSet())
            // A past due date is never accepted, so saving a Missed chore reopens it (BR-25).
            if (chore.state(today) == ChoreState.MISSED && ChoreRules.limitReached(queries.unfinishedCount(childId, today))) {
                throw DomainException(ErrorCode.CHORE_LIMIT_REACHED)
            }
            jdbc.sql("UPDATE chore SET name = ?, icon_key = ?, due_date = ?, updated_at = ? WHERE id = ?")
                .params(listOf(valid.name, valid.iconKey, valid.dueDate, now(), choreId)).update()
            val kept = valid.tasks.mapNotNull { it.id }.toSet()
            for (task in chore.tasks) {
                if (task.taskId !in kept) jdbc.sql("DELETE FROM chore_task WHERE id = ?").param(task.taskId).update()
            }
            valid.tasks.forEachIndexed { index, task ->
                if (task.id != null) {
                    jdbc.sql("UPDATE chore_task SET position = ?, label = ?, icon_key = ? WHERE id = ? AND chore_id = ?")
                        .params(index + 1, task.label, task.iconKey, task.id, choreId).update()
                } else {
                    jdbc.sql("INSERT INTO chore_task (chore_id, position, label, icon_key) VALUES (?, ?, ?, ?)")
                        .params(choreId, index + 1, task.label, task.iconKey).update()
                }
            }
            requireNotNull(queries.loadOne(choreId)).toDto(today, parent = true)
        }
    }

    override fun remove(choreId: Long) {
        val childId = queries.childIdOf(choreId) ?: throw notFound()
        childLock.withChildLock(childId) {
            settlement.settleLocked(childId)
            val chore = queries.loadOne(choreId) ?: throw notFound()
            if (chore.removed) return@withChildLock
            if (chore.sticker != null) throw DomainException(ErrorCode.CHORE_LOCKED)
            jdbc.sql("UPDATE chore SET removed_at = ?, updated_at = ? WHERE id = ?").params(now(), now(), choreId).update()
            log.info("chore removed childId={} choreId={}", childId, choreId)
        }
    }

    override fun list(filter: String, childId: Long?, cursor: String?): ChorePageDto {
        if (filter != FILTER_ACTIVE && filter != FILTER_CLOSED) {
            throw ChoreInputValidator.fieldFailure(listOf(FieldErrorDto("filter", "Use active or closed")))
        }
        val after = if (filter == FILTER_CLOSED && !cursor.isNullOrEmpty()) {
            ChoreCursor.decode(cursor) ?: throw ChoreInputValidator.fieldFailure(listOf(FieldErrorDto("cursor", "Not a valid cursor")))
        } else {
            null
        }
        val children = if (childId != null) {
            if (!queries.childExists(childId)) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
            listOf(childId)
        } else {
            queries.childIds()
        }
        children.forEach(settlement::settleIfNeeded)
        val today = clock.today()
        if (filter == FILTER_ACTIVE) {
            return ChorePageDto(queries.unfinished(children, today).map { it.toDto(today, parent = true) }, null)
        }
        val rows = queries.closed(children, today, ChoreRules.missedCutoff(today), after, PAGE_SIZE + 1)
        val items = rows.take(PAGE_SIZE).map { it.toDto(today, parent = true) }
        val next = if (rows.size > PAGE_SIZE) items.last().let { ChoreCursor(requireNotNull(it.closedOn), it.choreId).encode() } else null
        return ChorePageDto(items, next)
    }

    override fun recent(): List<ChoreSuggestionDto> = queries.recent(RECENT_LIMIT).map { chore ->
        ChoreSuggestionDto(chore.name, chore.iconKey, chore.tasks.map { ChoreSuggestionTaskDto(it.label, it.iconKey) })
    }

    override fun checkTask(childId: Long, choreId: Long, taskId: Long, actor: Actor): ChoreResultDto = childLock.withChildLock(childId) {
        settlement.settleLocked(childId)
        val today = clock.today()
        val chore = resolve(childId, choreId, taskId)
        if (chore.sticker == null) {
            if (chore.state(today) == ChoreState.MISSED) throw DomainException(ErrorCode.CHORE_MISSED)
            jdbc.sql("UPDATE chore_task SET checked_at = ?, checked_by = ? WHERE id = ? AND checked_at IS NULL")
                .params(now(), actor.name, taskId).update()
        }
        ChoreResultDto(view(choreId, today, actor), null, null)
    }

    override fun undoTask(
        childId: Long,
        choreId: Long,
        taskId: Long,
        actor: Actor,
        revokeSticker: Boolean,
        removeChore: Boolean,
        note: String?,
    ): ChoreResultDto = childLock.withChildLock(childId) {
        settlement.settleLocked(childId)
        val today = clock.today()
        val chore = resolve(childId, choreId, taskId)
        val sticker = chore.sticker
        if (sticker != null) {
            if (actor != Actor.PARENT) throw DomainException(ErrorCode.CHORE_LOCKED)
            if (!revokeSticker) {
                throw DomainException(
                    ErrorCode.REVOKE_CONFIRMATION_REQUIRED,
                    properties = mapOf("sticker" to ChartQueries.stickerDto(sticker, parent = true)),
                )
            }
            val revoked = revoker.revokeLocked(childId, choreId, taskId, note, removeChore)
            val gone = removeChore && revoked != null
            return@withChildLock ChoreResultDto(if (gone) null else view(choreId, today, actor), null, revoked)
        }
        // A plain undo, also on a Missed chore (only a check is refused there).
        jdbc.sql("UPDATE chore_task SET checked_at = NULL, checked_by = NULL WHERE id = ?").param(taskId).update()
        ChoreResultDto(view(choreId, today, actor), null, null)
    }

    override fun finish(childId: Long, choreId: Long, actor: Actor): ChoreResultDto = childLock.withChildLock(childId) {
        settlement.settleLocked(childId)
        val today = clock.today()
        val chore = load(childId, choreId)
        val existing = chore.sticker
        if (existing != null) {
            val pick = if (existing.status == StickerStatus.UNCLAIMED) earner.getPick(existing.stickerId) else null
            return@withChildLock ChoreResultDto(chore.toChartDto(today, actor == Actor.PARENT), pick, null)
        }
        if (chore.state(today) == ChoreState.MISSED) throw DomainException(ErrorCode.CHORE_MISSED)
        if (chore.tasks.any { !it.checked }) throw DomainException(ErrorCode.CHORE_NOT_READY)
        val pick: StickerPickDto = earner.earn(childId, EarnSource.Chore(choreId), today, chore.name, chore.iconKey, FinishMode.TAPPED)
        log.info("chore finished childId={} choreId={} stickerId={}", childId, choreId, pick.stickerId)
        ChoreResultDto(view(choreId, today, actor), pick, null)
    }

    private fun notFound() = DomainException(ErrorCode.NOT_FOUND, "Chore not found")

    /** The chore of this child, not removed, otherwise 404. */
    private fun load(childId: Long, choreId: Long): ChoreRecord =
        queries.loadOne(choreId)?.takeIf { it.childId == childId && !it.removed } ?: throw notFound()

    private fun resolve(childId: Long, choreId: Long, taskId: Long): ChoreRecord {
        val chore = load(childId, choreId)
        if (chore.tasks.none { it.taskId == taskId }) throw DomainException(ErrorCode.NOT_FOUND, "Task not found")
        return chore
    }

    private fun view(choreId: Long, today: LocalDate, actor: Actor): ChartChoreDto =
        requireNotNull(queries.loadOne(choreId)).toChartDto(today, actor == Actor.PARENT)

    private companion object {
        const val FILTER_ACTIVE = "active"
        const val FILTER_CLOSED = "closed"
        const val PAGE_SIZE = 50
        const val RECENT_LIMIT = 12
    }
}
