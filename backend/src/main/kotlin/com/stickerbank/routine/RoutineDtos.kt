package com.stickerbank.routine

import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.Weekday
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Size
import java.time.LocalDate

data class TaskInput(
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) val id: Long?,
    @field:NotBlank @field:Size(max = 60) val label: String,
    @field:NotBlank val iconKey: String,
)

data class RoutineInput(
    @field:NotBlank @field:Size(max = 60) val name: String,
    @field:NotBlank val iconKey: String,
    val color: String?,
    /** null means all 7 days on create; if present must be non-empty. */
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED) @field:Size(min = 1) val days: List<Weekday>?,
    val paused: Boolean = false,
    @field:Size(max = 30) @field:Valid val tasks: List<TaskInput>,
)

data class TaskDto(val id: Long, val label: String, val iconKey: String, val position: Int)

data class RoutineDto(
    val id: Long,
    val childId: Long,
    val position: Int,
    val name: String,
    val iconKey: String,
    val color: String?,
    val days: List<Weekday>,
    val paused: Boolean,
    val effectiveFrom: LocalDate,
    val tasks: List<TaskDto>,
    val upcomingSkips: List<LocalDate>,
)

data class RoutineSaveResultDto(
    val routine: RoutineDto,
    val effectiveFrom: LocalDate,
    val appliesFromTomorrow: Boolean,
    val earnedPick: StickerPickDto?,
)

data class RoutineDeleteResultDto(val routineId: Long, val effectiveFrom: LocalDate)

data class RoutineOrderRequest(@field:NotEmpty val routineIds: List<Long>)

data class RoutineCopyRequest(val targetChildId: Long)
