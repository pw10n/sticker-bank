package com.stickerbank.routine

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.Weekday
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RoutineInputValidatorTest {
    private val validator = RoutineInputValidator(ArtworkCatalog())

    private fun input(
        name: String = "  Morning  ",
        icon: String = "crescent-moon",
        color: String? = null,
        days: List<Weekday>? = null,
        tasks: List<TaskInput> = listOf(TaskInput(null, "  Brush teeth ", "bathtub")),
    ) = RoutineInput(name, icon, color, days, false, tasks)

    @Suppress("UNCHECKED_CAST")
    private fun errorsOf(block: () -> Unit): List<FieldErrorDto> {
        val e = catchDomain(block)
        assertThat(e.code).isEqualTo(ErrorCode.VALIDATION_FAILED)
        return e.properties["fieldErrors"] as List<FieldErrorDto>
    }

    private fun catchDomain(block: () -> Unit): DomainException {
        var caught: DomainException? = null
        try {
            block()
        } catch (e: DomainException) {
            caught = e
        }
        return requireNotNull(caught) { "expected DomainException" }
    }

    @Test
    fun `trims name and labels, upper-cases color, null days stay null`() {
        val valid = validator.validate(input(color = "#ffb703"), creating = true)
        assertThat(valid.name).isEqualTo("Morning")
        assertThat(valid.color).isEqualTo("#FFB703")
        assertThat(valid.daysMask).isNull()
        assertThat(valid.tasks.single().label).isEqualTo("Brush teeth")
    }

    @Test
    fun `days are converted to a mask`() {
        assertThat(validator.validate(input(days = listOf(Weekday.MON, Weekday.FRI)), creating = false).daysMask).isEqualTo(0b10001)
    }

    @Test
    fun `empty days is rejected with the pause hint`() {
        val errors = errorsOf { validator.validate(input(days = emptyList()), creating = true) }
        assertThat(errors.map { it.field }).contains("days")
        assertThat(errors.first { it.field == "days" }.message).contains("Pause")
    }

    @Test
    fun `31 tasks are rejected and 30 accepted`() {
        fun tasks(n: Int) = (1..n).map { TaskInput(null, "T$it", "bathtub") }
        assertThat(errorsOf { validator.validate(input(tasks = tasks(31)), creating = true).tasks }.map { it.field }).contains("tasks")
        assertThat(validator.validate(input(tasks = tasks(30)), creating = true).tasks).hasSize(30)
        assertThat(validator.validate(input(tasks = emptyList()), creating = true).tasks).isEmpty()
    }

    @Test
    fun `blank and overlong names and labels are rejected`() {
        assertThat(errorsOf { validator.validate(input(name = "   "), creating = true) }.map { it.field }).containsExactly("name")
        assertThat(errorsOf { validator.validate(input(name = "x".repeat(61)), creating = true) }.map { it.field }).containsExactly("name")
        val errors = errorsOf { validator.validate(input(tasks = listOf(TaskInput(null, " ", "bathtub"))), creating = true) }
        assertThat(errors.map { it.field }).containsExactly("tasks[0].label")
    }

    @Test
    fun `unknown artwork and color are reported per field`() {
        val ok = TaskInput(null, "ok", "bathtub")
        val errors =
            errorsOf {
                validator.validate(
                    input(icon = "nope", color = "#123456", tasks = listOf(ok, TaskInput(null, "ok", "nope"))),
                    creating = true,
                )
            }
        assertThat(errors.map { it.field }).containsExactlyInAnyOrder("iconKey", "color", "tasks[1].iconKey")
    }

    @Test
    fun `task ids are rejected on create and duplicates on update`() {
        val onCreate = errorsOf { validator.validate(input(tasks = listOf(TaskInput(7, "a", "bathtub"))), creating = true) }
        assertThat(onCreate.map { it.field }).containsExactly("tasks[0].id")
        val twice = listOf(TaskInput(7, "a", "bathtub"), TaskInput(7, "b", "bathtub"))
        val dup = errorsOf { validator.validate(input(tasks = twice), creating = false) }
        assertThat(dup.map { it.field }).containsExactly("tasks[1].id")
        val once = validator.validate(input(tasks = listOf(TaskInput(7, "a", "bathtub"))), creating = false)
        assertThat(once.tasks.single().id).isEqualTo(7L)
    }
}
