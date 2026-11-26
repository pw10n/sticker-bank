package com.stickerbank.common

import java.time.Instant
import java.time.LocalDate

/** What earned a sticker (TDD 7.5): a routine on its chart day, or a chore. */
sealed interface EarnSource {
    data class Routine(val routineId: Long) : EarnSource

    data class Chore(val choreId: Long) : EarnSource
}

interface StickerEarner {
    /** Caller MUST be inside a transaction holding ChildLock for childId and MUST have verified that [source] has no
     *  live sticker (for a routine: none for (routineId, chartDate); for a chore: none at all). Inserts the sticker
     *  (UNCLAIMED + 1-3 pick choices, or AVAILABLE with the fallback design when there are no choices to offer) and
     *  returns the pick. [label] and [iconKey] are the snapshot: the routine's name and icon, or the chore's.
     *  Only routine Finish (TDD 7.4), chore Finish (TDD 7.13) and day settlement (TDD 7.12) call this.
     *  [earnedAt] defaults to now; settlement passes the end of the finished day. */
    fun earn(
        childId: Long,
        source: EarnSource,
        chartDate: LocalDate,
        label: String,
        iconKey: String,
        finishMode: FinishMode,
        earnedAt: Instant? = null,
    ): StickerPickDto

    /** The pick of an existing sticker: its saved choices while UNCLAIMED, otherwise the claimed design. */
    fun getPick(stickerId: Long): StickerPickDto
}
