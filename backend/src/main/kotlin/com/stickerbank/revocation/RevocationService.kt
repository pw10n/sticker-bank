package com.stickerbank.revocation

import com.stickerbank.chart.TaskToggleResultDto
import com.stickerbank.routine.PlannedRoutine
import java.time.LocalDate

interface RevocationService {
    /** Revokes the live sticker of [planned] for [date]; the caller already holds the child lock and the transaction. */
    fun revokeLocked(
        childId: Long,
        routineId: Long,
        planned: PlannedRoutine,
        date: LocalDate,
        taskId: Long,
        note: String?,
    ): TaskToggleResultDto

    fun revocationsFor(childId: Long, from: LocalDate, to: LocalDate): Map<LocalDate, List<RevocationDto>>
}
