package com.stickerbank.revocation

import com.stickerbank.chart.RevokedStickerDto
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

    /**
     * The part of a revoke that every sticker owner shares: TDD 7.11 steps 5 and 6.2 to 6.5, for one live sticker.
     * USED -> `STICKER_USED`, and nothing changes. A PENDING sticker leaves its Prize Request, which is cancelled
     * (`ALL_STICKERS_REVOKED`) if that leaves it empty. The sticker becomes REVOKED and keeps its saved choices, and a
     * `sticker_revocation` row is inserted with the sticker's `chart_date`, [taskId] and [taskLabel].
     *
     * The caller holds the child lock inside one transaction and undoes its own check: a routine deletes the
     * `task_completion` row, a chore clears `chore_task.checked_at`. [taskId] is a routine task id, so a chore passes
     * `null` (I-31). [stickerId] must be a live sticker of [childId]; anything else answers `NOT_FOUND`.
     */
    fun revokeStickerLocked(childId: Long, stickerId: Long, taskId: Long?, taskLabel: String, note: String?): RevokedStickerDto

    /** Every revoke of the child whose `chart_date` is in the range, routine and chore stickers alike, by day. */
    fun revocationsFor(childId: Long, from: LocalDate, to: LocalDate): Map<LocalDate, List<RevocationDto>>
}
