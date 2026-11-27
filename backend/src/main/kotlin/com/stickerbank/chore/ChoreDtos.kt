package com.stickerbank.chore

import com.stickerbank.chart.ChartStickerDto
import com.stickerbank.chart.ChartTaskDto
import com.stickerbank.chart.RevokedStickerDto
import com.stickerbank.common.StickerPickDto
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate

/**
 * A chore's derived state (TDD 7.3 "Chores on the chart", TD-22). Never stored. The names are a routine's without
 * SKIPPED, but MISSED here means the due date passed.
 */
enum class ChoreState { NOT_STARTED, IN_PROGRESS, READY_TO_FINISH, AWAITING_PICK, EARNED, MISSED }

/** [id] is sent on an edit only: a task that carries it keeps its identity and its check (I-28). */
data class ChoreTaskInput(
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) val id: Long?,
    @field:NotBlank @field:Size(max = 60) val label: String,
    @field:NotBlank val iconKey: String,
)

/**
 * The whole definition of a chore, for assign and edit (TDD 7.13, 8.3). The annotations document the limits in the
 * contract; the rules themselves, with every field error collected, are checked by the chore input validator.
 * [alreadyDone] is for assign only (FR-13.11).
 */
data class ChoreInput(
    @field:NotBlank @field:Size(max = 60) val name: String,
    @field:NotBlank val iconKey: String,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) val dueDate: LocalDate?,
    @field:Size(min = 1, max = 6) @field:Valid val tasks: List<ChoreTaskInput>,
    val alreadyDone: Boolean = false,
)

/**
 * A chore as the chart shows it. [tasks] are [ChartTaskDto]s whose `taskId` is a `chore_task.id`, a different id space
 * from routine task ids. [sticker] carries the parent-only fields for a PARENT actor, as on a routine.
 */
data class ChartChoreDto(
    val choreId: Long,
    val name: String,
    val iconKey: String,
    val dueDate: LocalDate?,
    val state: ChoreState,
    val doneCount: Int,
    val taskCount: Int,
    val tasks: List<ChartTaskDto>,
    val sticker: ChartStickerDto?,
)

/** The chore twin of TaskToggleResultDto. [chore] is null only when a revoke also removed the chore (FR-13.24). */
data class ChoreResultDto(val chore: ChartChoreDto?, val pick: StickerPickDto?, val revoked: RevokedStickerDto?)

/**
 * A chore in the parent lists and in the assign and edit responses: the [ChartChoreDto] fields plus [childId],
 * [closedOn] (the day it was finished or missed, null while unfinished) and [createdAt].
 */
data class ChoreDto(
    val choreId: Long,
    val childId: Long,
    val name: String,
    val iconKey: String,
    val dueDate: LocalDate?,
    val state: ChoreState,
    val doneCount: Int,
    val taskCount: Int,
    val tasks: List<ChartTaskDto>,
    val sticker: ChartStickerDto?,
    val closedOn: LocalDate?,
    val createdAt: Instant,
)

data class ChorePageDto(val items: List<ChoreDto>, val nextCursor: String?)

data class HistoryChoreDto(
    val choreId: Long,
    val name: String,
    val iconKey: String,
    val state: ChoreState,
    val doneCount: Int,
    val taskCount: Int,
    val stickerId: Long?,
    /** True when the end of the due date earned this chore's sticker instead of I'm Done! (FR-13.20). */
    val autoFinished: Boolean,
)

data class ChoreSuggestionTaskDto(val label: String, val iconKey: String)

data class ChoreSuggestionDto(val name: String, val iconKey: String, val tasks: List<ChoreSuggestionTaskDto>)
