package com.stickerbank.prize

import com.stickerbank.common.Actor
import com.stickerbank.common.DesignRefDto
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate

enum class PrizeRequestStatus { PENDING, COMPLETED, CANCELLED, REVERSED }

enum class PrizeCancelReason { CANCELLED, ALL_STICKERS_REVOKED }

data class PrizeRequestCreateRequest(@field:NotEmpty val stickerIds: List<Long>)

data class PrizeCompleteRequest(
    @field:NotBlank @field:Size(max = 200) val prizeText: String,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) @field:Size(max = 500) val note: String?,
)

data class PrizeEditRequest(
    @field:NotBlank @field:Size(max = 200) val prizeText: String,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) @field:Size(max = 500) val note: String?,
)

data class PrizeStickerDto(
    val stickerId: Long,
    val chartDate: LocalDate,
    val routineName: String?,
    val design: DesignRefDto,
    val revoked: Boolean,
)

data class PrizeRequestDto(
    val id: Long,
    val childId: Long,
    val childName: String,
    val status: PrizeRequestStatus,
    val createdBy: Actor,
    val stickerCount: Int,
    val stickers: List<PrizeStickerDto>,
    val prizeText: String?,
    val note: String?,
    val createdAt: Instant,
    val completedAt: Instant?,
    val cancelledAt: Instant?,
    val cancelledBy: Actor?,
    val cancelReason: PrizeCancelReason?,
    val reversedAt: Instant?,
)

data class PendingPrizeRequestDto(val request: PrizeRequestDto?)

data class PrizeRequestPageDto(val items: List<PrizeRequestDto>, val nextCursor: String?)
