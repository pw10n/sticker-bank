package com.stickerbank.chore

import com.stickerbank.common.StickerStatus
import java.time.LocalDate

/** Pure chore rules (TDD 7.3 "Chores on the chart", 10.2). */
object ChoreRules {
    const val MAX_UNFINISHED = 5
    const val MAX_TASKS = 6
    const val MAX_TEXT = 60

    /** How long a Missed chore stays in the parent's closed list (I-37). */
    const val MISSED_LISTED_DAYS = 30L

    /** First matching row wins. Nothing here is stored (TD-22). */
    fun deriveState(stickerStatus: StickerStatus?, dueDate: LocalDate?, today: LocalDate, doneCount: Int, taskCount: Int): ChoreState =
        when {
            stickerStatus == StickerStatus.UNCLAIMED -> ChoreState.AWAITING_PICK
            stickerStatus != null -> ChoreState.EARNED
            dueDate != null && dueDate.isBefore(today) -> ChoreState.MISSED
            taskCount > 0 && doneCount >= taskCount -> ChoreState.READY_TO_FINISH
            doneCount > 0 -> ChoreState.IN_PROGRESS
            else -> ChoreState.NOT_STARTED
        }

    /** Unfinished means NOT_STARTED, IN_PROGRESS or READY_TO_FINISH (I-30). */
    fun isUnfinished(state: ChoreState): Boolean =
        state == ChoreState.NOT_STARTED || state == ChoreState.IN_PROGRESS || state == ChoreState.READY_TO_FINISH

    /** The limit is checked on assign and reopen, with [unfinishedCount] the child's current unfinished chores. */
    fun limitReached(unfinishedCount: Int): Boolean = unfinishedCount >= MAX_UNFINISHED

    /** The day a chore closed: its sticker's chart date, or its due date when it is Missed. Null while unfinished. */
    fun closedOn(state: ChoreState, stickerDate: LocalDate?, dueDate: LocalDate?): LocalDate? = when {
        stickerDate != null -> stickerDate
        state == ChoreState.MISSED -> dueDate
        else -> null
    }

    /** The first day a Missed chore is no longer listed on the Chores page: due dates before this are cut off. */
    fun missedCutoff(today: LocalDate): LocalDate = today.minusDays(MISSED_LISTED_DAYS)

    /**
     * The day a chore is listed on, for a chart day range, or null when it is on none of them (TDD 7.3): a finished one
     * on its sticker's day, a Missed one on its due date, and an unfinished one on today.
     */
    fun chartDay(state: ChoreState, stickerDate: LocalDate?, dueDate: LocalDate?, today: LocalDate): LocalDate? = when {
        stickerDate != null -> stickerDate
        state == ChoreState.MISSED -> dueDate
        else -> today
    }
}
