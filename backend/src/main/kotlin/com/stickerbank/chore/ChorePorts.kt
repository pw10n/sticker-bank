package com.stickerbank.chore

import com.stickerbank.common.Actor
import java.time.LocalDate

/**
 * The seams between chores and the rest of the app (TDD 7.13). Each port has exactly one bean. Until the real
 * implementations land, the stubs in `chore/stub` stand in for them.
 */
interface ChoreService {
    fun assign(childId: Long, input: ChoreInput): ChoreDto

    /** Edit, or reopen a Missed chore. */
    fun save(choreId: Long, input: ChoreInput): ChoreDto

    fun remove(choreId: Long)

    /** [filter] is "active" or "closed". */
    fun list(filter: String, childId: Long?, cursor: String?): ChorePageDto

    fun recent(): List<ChoreSuggestionDto>

    fun checkTask(childId: Long, choreId: Long, taskId: Long, actor: Actor): ChoreResultDto

    fun undoTask(
        childId: Long,
        choreId: Long,
        taskId: Long,
        actor: Actor,
        revokeSticker: Boolean,
        removeChore: Boolean,
        note: String?,
    ): ChoreResultDto

    fun finish(childId: Long, choreId: Long, actor: Actor): ChoreResultDto
}

/** Used by ChartService and HistoryService, after they have settled the child's ended days. */
interface ChoreReader {
    /**
     * TDD 7.3 "Chores on the chart": selection, states and order for each day in [from, to]. A day with no chores may
     * be left out of the map. With [parent], each sticker carries the parent-only fields.
     */
    fun choresByDay(childId: Long, from: LocalDate, to: LocalDate, today: LocalDate, parent: Boolean): Map<LocalDate, List<ChartChoreDto>>
}

/** Called by DaySettlement inside the child lock, so an implementation must not depend on DaySettlement. */
interface ChoreSettlement {
    /** TDD 7.12 step 5: every past-due, fully checked, non-removed chore without a live sticker. Not range-limited. */
    fun finishDueChoresLocked(childId: Long, today: LocalDate)
}

/** Called by ChoreService.undoTask inside the child lock. */
interface ChoreRevoker {
    fun revokeLocked(childId: Long, choreId: Long, taskId: Long, note: String?, removeChore: Boolean): ChoreResultDto
}
