package com.stickerbank.common

import java.time.LocalDate

interface StickerEarner {
    /** Caller MUST be inside a transaction holding ChildLock for childId and MUST have verified that no sticker row
     *  exists for (routineId, chartDate). Inserts the sticker (UNCLAIMED + 1-3 pick choices, or AVAILABLE with the
     *  fallback design when the pick pool is empty) and returns the pick. */
    fun earn(childId: Long, routineId: Long, chartDate: LocalDate, routineName: String, routineIconKey: String): StickerPickDto
}
