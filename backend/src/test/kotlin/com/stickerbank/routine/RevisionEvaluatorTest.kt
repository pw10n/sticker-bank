package com.stickerbank.routine

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.time.LocalDate

class RevisionEvaluatorTest {
    private val thursday = LocalDate.of(2026, 10, 15)
    private val saturday = LocalDate.of(2026, 10, 17)
    private val allDays = 0b1111111
    private val monToFri = 0b0011111

    private fun tasks(vararg ids: Long) = ids.mapIndexed { i, id -> PlannedTask(id, i + 1, "Task $id", "bathtub") }

    private fun rev(
        revisionId: Long,
        from: LocalDate,
        routineId: Long = 1,
        position: Int = 1,
        name: String = "Morning",
        mask: Int = allDays,
        paused: Boolean = false,
        deleted: Boolean = false,
        tasks: List<PlannedTask> = tasks(10, 11),
    ) = RevisionRecord(routineId, 5, position, revisionId, from, name, "crescent-moon", null, mask, paused, deleted, tasks)

    @Test
    fun `latest revision effective on or before the date wins`() {
        val revisions =
            listOf(
                rev(1, thursday.minusDays(10), name = "Old"),
                rev(2, thursday, name = "New"),
                rev(3, thursday.plusDays(1), name = "Later"),
            )
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday.minusDays(1), emptySet())?.name).isEqualTo("Old")
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday, emptySet())?.name).isEqualTo("New")
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday.plusDays(1), emptySet())?.name).isEqualTo("Later")
    }

    @Test
    fun `no revision yet means not planned`() {
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday)), thursday.minusDays(1), emptySet())).isNull()
    }

    @Test
    fun `deleted paused off-weekday and zero-task revisions are excluded`() {
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday, deleted = true)), thursday, emptySet())).isNull()
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday, paused = true)), thursday, emptySet())).isNull()
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday, mask = monToFri)), saturday, emptySet())).isNull()
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday, mask = monToFri)), thursday, emptySet())).isNotNull()
        assertThat(RevisionEvaluator.plannedFor(listOf(rev(1, thursday, tasks = emptyList())), thursday, emptySet())).isNull()
    }

    @Test
    fun `past day keeps its revision after a later delete`() {
        val revisions = listOf(rev(1, thursday.minusDays(5)), rev(2, thursday, deleted = true))
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday.minusDays(1), emptySet())).isNotNull()
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday, emptySet())).isNull()
    }

    @Test
    fun `skip flag reflects the skipped date only`() {
        val revisions = listOf(rev(1, thursday.minusDays(5)))
        val skips = setOf(thursday)
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday, skips)?.skipped).isTrue()
        assertThat(RevisionEvaluator.plannedFor(revisions, thursday.plusDays(1), skips)?.skipped).isFalse()
    }

    @Test
    fun `tasks are ordered by position`() {
        val unordered = listOf(PlannedTask(2, 2, "b", "bathtub"), PlannedTask(1, 1, "a", "bathtub"))
        val planned = RevisionEvaluator.plannedFor(listOf(rev(1, thursday, tasks = unordered)), thursday, emptySet())
        assertThat(planned?.tasks?.map { it.taskId }).containsExactly(1L, 2L)
    }

    @Test
    fun `plan orders routines by position then id and applies skips per routine`() {
        val byRoutine =
            mapOf(
                3L to listOf(rev(30, thursday.minusDays(1), routineId = 3, position = 1)),
                1L to listOf(rev(10, thursday.minusDays(1), routineId = 1, position = 2)),
                2L to listOf(rev(20, thursday.minusDays(1), routineId = 2, position = 1)),
            )
        val plan = RevisionEvaluator.plan(byRoutine, setOf(2L to thursday), thursday)
        assertThat(plan.map { it.routineId }).containsExactly(2L, 3L, 1L)
        assertThat(plan.associate { it.routineId to it.skipped }).containsEntry(2L, true).containsEntry(3L, false)
    }

    @Test
    fun `edit date rule`() {
        assertThat(RevisionPolicy.effectiveDate(thursday, stickerExistsToday = false)).isEqualTo(thursday)
        assertThat(RevisionPolicy.effectiveDate(thursday, stickerExistsToday = true)).isEqualTo(thursday.plusDays(1))
    }
}
