package com.stickerbank.chart

import com.fasterxml.jackson.annotation.JsonProperty
import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.revocation.RevocationDto
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.Size
import java.time.LocalDate

/** READY_TO_FINISH: every task is done but I'm Done! has not been tapped, so there is no sticker yet (TDD 7.3, TD-18). */
enum class RoutineDayState { NOT_STARTED, IN_PROGRESS, READY_TO_FINISH, AWAITING_PICK, EARNED, MISSED, SKIPPED }

data class ChartTaskDto(val taskId: Long, val label: String, val iconKey: String, val done: Boolean)

/**
 * [prizeRequestId], [revocable] and [autoFinished] are only filled for a PARENT actor (TDD 7.3, 7.11); `revocable` is
 * false only for USED, and `autoFinished` marks a sticker the day's end earned instead of I'm Done! (FR-6.11, I-25).
 */
data class ChartStickerDto(
    val stickerId: Long,
    val status: StickerStatus,
    val design: DesignRefDto?,
    val prizeRequestId: Long?,
    val revocable: Boolean?,
    val autoFinished: Boolean?,
)

data class RevokedStickerDto(val stickerId: Long, val fromStatus: StickerStatus, val prizeRequestId: Long?, val requestCancelled: Boolean)

data class RevokeStickerRequest(@field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) @field:Size(max = 200) val note: String?)

data class ChartRoutineDto(
    val routineId: Long,
    val name: String,
    val iconKey: String,
    val color: String?,
    val state: RoutineDayState,
    val doneCount: Int,
    val taskCount: Int,
    val tasks: List<ChartTaskDto>,
    val sticker: ChartStickerDto?,
)

data class UnclaimedStickerDto(val stickerId: Long, val chartDate: LocalDate, val routineName: String?, val routineIconKey: String?)

data class DailyChartDto(
    val childId: Long,
    val date: LocalDate,
    @get:JsonProperty("isToday") val isToday: Boolean,
    val routines: List<ChartRoutineDto>,
    val unclaimedFromEarlierDays: List<UnclaimedStickerDto>,
)

data class TaskToggleResultDto(val routine: ChartRoutineDto, val pick: StickerPickDto?, val revoked: RevokedStickerDto?)

data class HistoryRoutineDto(
    val routineId: Long,
    val name: String,
    val iconKey: String,
    val state: RoutineDayState,
    val doneCount: Int,
    val taskCount: Int,
    val stickerId: Long?,
    /** True when the day's end earned this routine's sticker instead of I'm Done! (FR-6.11). */
    val autoFinished: Boolean,
)

data class HistoryDayDto(val date: LocalDate, val routines: List<HistoryRoutineDto>, val revocations: List<RevocationDto>)

data class HistoryDto(val childId: Long, val from: LocalDate, val to: LocalDate, val days: List<HistoryDayDto>)
