package com.stickerbank.revocation

import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.StickerStatus
import java.time.Instant
import java.time.LocalDate

data class RevocationDto(
    val stickerId: Long,
    val childId: Long,
    val chartDate: LocalDate,
    val routineId: Long?,
    /** Set when the revoked sticker was earned by a chore; `routineId` is then null (TDD 8.3). */
    val choreId: Long?,
    val routineName: String?,
    val routineIconKey: String?,
    val taskId: Long?,
    val taskLabel: String,
    val fromStatus: StickerStatus,
    val design: DesignRefDto?,
    val prizeRequestId: Long?,
    val requestCancelled: Boolean,
    val note: String?,
    val revokedAt: Instant,
)
