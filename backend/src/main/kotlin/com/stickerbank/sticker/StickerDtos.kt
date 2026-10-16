package com.stickerbank.sticker

import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.StickerStatus
import java.time.Instant
import java.time.LocalDate

enum class StickerSource { ROUTINE, BONUS }

data class PickClaimRequest(val designId: Long)

data class StickerCountsDto(val available: Int, val pending: Int, val used: Int, val totalEarned: Int, val unclaimed: Int)

data class BookStickerDto(
    val stickerId: Long,
    val childId: Long,
    val status: StickerStatus,
    val source: StickerSource,
    val chartDate: LocalDate,
    val routineName: String?,
    val routineIconKey: String?,
    val design: DesignRefDto,
    val earnedAt: Instant,
    val claimedAt: Instant?,
    val prizeRequestId: Long?,
)

data class StickerBookPageDto(val counts: StickerCountsDto, val items: List<BookStickerDto>, val nextCursor: String?)

data class StickerPrizeDto(val prizeRequestId: Long, val prizeText: String, val note: String?, val completedAt: Instant)

data class StickerDetailDto(
    val stickerId: Long,
    val childId: Long,
    val status: StickerStatus,
    val source: StickerSource,
    val chartDate: LocalDate,
    val routineName: String?,
    val routineIconKey: String?,
    val design: DesignRefDto?,
    val earnedAt: Instant,
    val claimedAt: Instant?,
    val prize: StickerPrizeDto?,
)
