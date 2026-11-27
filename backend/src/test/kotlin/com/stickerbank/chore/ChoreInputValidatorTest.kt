package com.stickerbank.chore

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.time.LocalDate

class ChoreInputValidatorTest {
    private val validator = ChoreInputValidator(ArtworkCatalog())
    private val today = LocalDate.of(2026, 10, 15)

    private fun task(label: String = "Blocks away", icon: String = "basket", id: Long? = null) = ChoreTaskInput(id, label, icon)

    private fun input(
        name: String = "  Tidy up  ",
        icon: String = "broom",
        due: LocalDate? = null,
        tasks: List<ChoreTaskInput> = listOf(task(label = "  Blocks away ")),
        alreadyDone: Boolean = false,
    ) = ChoreInput(name, icon, due, tasks, alreadyDone)

    @Suppress("UNCHECKED_CAST")
    private fun errorsOf(block: () -> Unit): List<FieldErrorDto> {
        val e = runCatching(block).exceptionOrNull()
        assertThat(e).isInstanceOf(DomainException::class.java)
        e as DomainException
        assertThat(e.code).isEqualTo(ErrorCode.VALIDATION_FAILED)
        return e.properties["fieldErrors"] as List<FieldErrorDto>
    }

    @Test
    fun `trims name and labels`() {
        val valid = validator.validate(input(), today, creating = true)
        assertThat(valid.name).isEqualTo("Tidy up")
        assertThat(valid.tasks.single().label).isEqualTo("Blocks away")
        assertThat(valid.dueDate).isNull()
    }

    @Test
    fun `blank or long name and label are rejected`() {
        val errors = errorsOf {
            validator.validate(input(name = "   ", tasks = listOf(task(label = "x".repeat(61)))), today, creating = true)
        }
        assertThat(errors.map { it.field }).containsExactlyInAnyOrder("name", "tasks[0].label")
        assertThat(validator.validate(input(name = "x".repeat(60)), today, creating = true).name).hasSize(60)
    }

    @Test
    fun `icons need the task use, the chore icon too`() {
        val errors = errorsOf {
            validator.validate(input(icon = "cat-face", tasks = listOf(task(icon = "whale"), task(icon = "nope"))), today, creating = true)
        }
        assertThat(errors.map { it.field }).containsExactlyInAnyOrder("iconKey", "tasks[0].iconKey", "tasks[1].iconKey")
    }

    @Test
    fun `due date is empty, today or later`() {
        assertThat(validator.validate(input(due = today), today, creating = true).dueDate).isEqualTo(today)
        assertThat(validator.validate(input(due = today.plusDays(9)), today, creating = true).dueDate).isEqualTo(today.plusDays(9))
        val errors = errorsOf { validator.validate(input(due = today.minusDays(1)), today, creating = true) }
        assertThat(errors.map { it.field }).containsExactly("dueDate")
    }

    @Test
    fun `one to six tasks`() {
        assertThat(
            errorsOf {
                validator.validate(input(tasks = emptyList()), today, creating = true)
            }.map { it.field },
        ).containsExactly("tasks")
        assertThat(errorsOf { validator.validate(input(tasks = List(7) { task() }), today, creating = true) }.map { it.field })
            .containsExactly("tasks")
        assertThat(validator.validate(input(tasks = List(6) { task() }), today, creating = true).tasks).hasSize(6)
    }

    @Test
    fun `on edit a task id must belong to the chore and appear once`() {
        val own = setOf(10L, 11L)
        val ok = validator.validate(input(tasks = listOf(task(id = 10), task(id = 11), task())), today, creating = false, ownTaskIds = own)
        assertThat(ok.tasks.map { it.id }).containsExactly(10L, 11L, null)
        val foreign = errorsOf { validator.validate(input(tasks = listOf(task(id = 99))), today, creating = false, ownTaskIds = own) }
        assertThat(foreign.map { it.field }).containsExactly("tasks[0].id")
        val twice =
            errorsOf { validator.validate(input(tasks = listOf(task(id = 10), task(id = 10))), today, creating = false, ownTaskIds = own) }
        assertThat(twice.map { it.field }).containsExactly("tasks[1].id")
    }

    @Test
    fun `a new chore cannot reference task ids`() {
        val errors = errorsOf { validator.validate(input(tasks = listOf(task(id = 10))), today, creating = true) }
        assertThat(errors.map { it.field }).containsExactly("tasks[0].id")
    }

    @Test
    fun `already done is for assign only and takes no due date`() {
        assertThat(validator.validate(input(alreadyDone = true), today, creating = true).alreadyDone).isTrue()
        assertThat(errorsOf { validator.validate(input(alreadyDone = true), today, creating = false) }.map { it.field })
            .containsExactly("alreadyDone")
        assertThat(errorsOf { validator.validate(input(alreadyDone = true, due = today), today, creating = true) }.map { it.field })
            .containsExactly("dueDate")
    }

    @Test
    fun `every error is collected`() {
        val errors = errorsOf {
            validator.validate(input(name = "", icon = "nope", due = today.minusDays(2), tasks = emptyList()), today, creating = true)
        }
        assertThat(errors.map { it.field }).containsExactlyInAnyOrder("name", "iconKey", "dueDate", "tasks")
    }
}
