package com.stickerbank.routine

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.ArtworkUse
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.Palette
import com.stickerbank.common.Weekdays
import org.springframework.stereotype.Component

data class ValidTask(val id: Long?, val label: String, val iconKey: String)

data class ValidRoutine(
    val name: String,
    val iconKey: String,
    val color: String?,
    /** null only when the input had no days (all 7 on create, keep-current on update). */
    val daysMask: Int?,
    val paused: Boolean,
    val tasks: List<ValidTask>,
)

/** Normalises and validates a [RoutineInput] (TDD 10.2, I-14), collecting every field error before failing. */
@Component
class RoutineInputValidator(private val artwork: ArtworkCatalog) {
    fun validate(input: RoutineInput, creating: Boolean): ValidRoutine {
        val errors = mutableListOf<FieldErrorDto>()
        val name = input.name.trim()
        if (name.isEmpty() || name.length > MAX_TEXT) errors += FieldErrorDto("name", "Name must be 1 to $MAX_TEXT characters")
        collect(errors) { artwork.require(input.iconKey, ArtworkUse.ROUTINE, "iconKey") }
        collect(errors) { Palette.require(input.color, "color", nullable = true) }
        val days = input.days
        if (days != null && days.isEmpty()) errors += FieldErrorDto("days", DAYS_MESSAGE)
        if (input.tasks.size > MAX_TASKS) errors += FieldErrorDto("tasks", "A routine can have at most $MAX_TASKS tasks")
        val tasks =
            input.tasks.mapIndexed { index, task ->
                val label = task.label.trim()
                if (label.isEmpty() || label.length > MAX_TEXT) {
                    errors += FieldErrorDto("tasks[$index].label", "Label must be 1 to $MAX_TEXT characters")
                }
                collect(errors) { artwork.require(task.iconKey, ArtworkUse.TASK, "tasks[$index].iconKey") }
                if (creating && task.id != null) errors += FieldErrorDto("tasks[$index].id", "New routines cannot reference existing tasks")
                ValidTask(task.id, label, task.iconKey)
            }
        val seen = mutableSetOf<Long>()
        tasks.forEachIndexed { index, task ->
            if (task.id != null && !seen.add(task.id)) errors += FieldErrorDto("tasks[$index].id", "Task listed twice")
        }
        if (errors.isNotEmpty()) throw fieldFailure(errors)
        return ValidRoutine(
            name = name,
            iconKey = input.iconKey,
            color = input.color?.uppercase(),
            daysMask = days?.let { Weekdays.toMask(it) },
            paused = input.paused,
            tasks = tasks,
        )
    }

    private fun collect(errors: MutableList<FieldErrorDto>, check: () -> Unit) {
        try {
            check()
        } catch (e: DomainException) {
            @Suppress("UNCHECKED_CAST")
            errors += (e.properties["fieldErrors"] as? List<FieldErrorDto>).orEmpty()
        }
    }

    companion object {
        const val MAX_TEXT = 60
        const val MAX_TASKS = 30
        const val DAYS_MESSAGE = "Pick at least one day — use Pause to switch a routine off"

        fun fieldFailure(errors: List<FieldErrorDto>) =
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to errors))
    }
}
