package com.stickerbank.common

import java.time.Instant
import java.time.LocalDate

interface StickerEarner {
    /** Caller MUST be inside a transaction holding ChildLock for childId and MUST have verified that no live sticker
     *  exists for (routineId, chartDate). Inserts the sticker (UNCLAIMED + 1-3 pick choices, or AVAILABLE with the
     *  fallback design when there are no choices to offer) and returns the pick. Only Finish (TDD 7.4) and day
     *  settlement (TDD 7.12) call this. [earnedAt] defaults to now; settlement passes the end of the finished day. */
    fun earn(
        childId: Long,
        routineId: Long,
        chartDate: LocalDate,
        routineName: String,
        routineIconKey: String,
        finishMode: FinishMode,
        earnedAt: Instant? = null,
    ): StickerPickDto

    /** The pick of an existing sticker: its saved choices while UNCLAIMED, otherwise the claimed design. */
    fun getPick(stickerId: Long): StickerPickDto
}
