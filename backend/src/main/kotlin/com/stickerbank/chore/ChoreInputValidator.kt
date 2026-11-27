package com.stickerbank.chore

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.ArtworkUse
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import org.springframework.stereotype.Component
import java.time.LocalDate

data class ValidChoreTask(val id: Long?, val label: String, val iconKey: String)

data class ValidChore(
    val name: String,
    val iconKey: String,
    val dueDate: LocalDate?,
    val tasks: List<ValidChoreTask>,
    val alreadyDone: Boolean,
)

/**
 * Normalises and validates a [ChoreInput] (TDD 7.13, 10.2), collecting every field error before failing. It is the only
 * validation a chore body gets. Field names: `name`, `iconKey`, `dueDate`, `tasks`, `tasks[i].label`, `tasks[i].iconKey`,
 * `tasks[i].id`, `alreadyDone`.
 */
@Component
class ChoreInputValidator(private val artwork: ArtworkCatalog) {
    /**
     * [creating] is assign; otherwise it is an edit and [ownTaskIds] are the ids of the chore's current tasks.
     * [today] must be read inside the child lock, after settling.
     */
    fun validate(input: ChoreInput, today: LocalDate, creating: Boolean, ownTaskIds: Set<Long> = emptySet()): ValidChore {
        val errors = mutableListOf<FieldErrorDto>()
        val name = input.name.trim()
        if (name.isEmpty() || name.length > ChoreRules.MAX_TEXT) {
            errors += FieldErrorDto("name", "Name must be 1 to ${ChoreRules.MAX_TEXT} characters")
        }
        collect(errors) { artwork.require(input.iconKey, ArtworkUse.TASK, "iconKey") }
        val due = input.dueDate
        if (due != null && due.isBefore(today)) errors += FieldErrorDto("dueDate", "The due date can't be in the past")
        if (input.alreadyDone) {
            if (!creating) errors += FieldErrorDto("alreadyDone", "Only when assigning a chore")
            if (due != null) errors += FieldErrorDto("dueDate", "A chore that is already done has no due date")
        }
        if (input.tasks.isEmpty() || input.tasks.size > ChoreRules.MAX_TASKS) {
            errors += FieldErrorDto("tasks", "A chore needs 1 to ${ChoreRules.MAX_TASKS} tasks")
        }
        val tasks =
            input.tasks.mapIndexed { index, task ->
                val label = task.label.trim()
                if (label.isEmpty() || label.length > ChoreRules.MAX_TEXT) {
                    errors += FieldErrorDto("tasks[$index].label", "Label must be 1 to ${ChoreRules.MAX_TEXT} characters")
                }
                collect(errors) { artwork.require(task.iconKey, ArtworkUse.TASK, "tasks[$index].iconKey") }
                if (task.id != null) {
                    if (creating) {
                        errors += FieldErrorDto("tasks[$index].id", "New chores cannot reference existing tasks")
                    } else if (task.id !in ownTaskIds) {
                        errors += FieldErrorDto("tasks[$index].id", "Not a task of this chore")
                    }
                }
                ValidChoreTask(task.id, label, task.iconKey)
            }
        val seen = mutableSetOf<Long>()
        tasks.forEachIndexed { index, task ->
            if (task.id != null && !seen.add(task.id)) errors += FieldErrorDto("tasks[$index].id", "Task listed twice")
        }
        if (errors.isNotEmpty()) throw fieldFailure(errors)
        return ValidChore(name, input.iconKey, due, tasks, input.alreadyDone)
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
        fun fieldFailure(errors: List<FieldErrorDto>) =
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to errors))
    }
}
