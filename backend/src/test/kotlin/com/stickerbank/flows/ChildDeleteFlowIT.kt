package com.stickerbank.flows

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@IntegrationTest
class ChildDeleteFlowIT : FlowTestBase() {
    private val today = LocalDate.of(2026, 10, 15)

    private fun rowsFor(childId: Long, routineId: Long): Map<String, Long> = mapOf(
        "child" to count("SELECT COUNT(*) FROM child WHERE id = ?", childId),
        "routine" to count("SELECT COUNT(*) FROM routine WHERE child_id = ?", childId),
        "routine_revision" to count("SELECT COUNT(*) FROM routine_revision WHERE routine_id = ?", routineId),
        "task" to count("SELECT COUNT(*) FROM task WHERE routine_id = ?", routineId),
        "revision_task" to count(
            "SELECT COUNT(*) FROM revision_task WHERE revision_id IN (SELECT id FROM routine_revision WHERE routine_id = ?)",
            routineId,
        ),
        "task_completion" to count("SELECT COUNT(*) FROM task_completion WHERE child_id = ?", childId),
        "sticker" to count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId),
        "sticker_pick_choice" to count(
            "SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id IN (SELECT id FROM sticker WHERE child_id = ?)",
            childId,
        ),
        "sticker_revocation" to count("SELECT COUNT(*) FROM sticker_revocation WHERE child_id = ?", childId),
        "prize_request" to count("SELECT COUNT(*) FROM prize_request WHERE child_id = ?", childId),
        "prize_request_item" to count(
            "SELECT COUNT(*) FROM prize_request_item WHERE prize_request_id IN (SELECT id FROM prize_request WHERE child_id = ?)",
            childId,
        ),
    )

    @Test
    fun `deleting a child removes only that child's data (FR-1-3, BR-14)`() {
        val parent = seededParent()
        val designs = fixtures.activeDesignIds()

        val doomed = fixtures.createChild("Jane Doe")
        val doomedRoutine = fixtures.createRoutine(doomed)
        val sibling = fixtures.createChild("Sam Roe")
        val siblingRoutine = fixtures.createRoutine(sibling)

        // the doomed child earns a routine sticker through the API, owns a spare one, and has a pending request
        doomedRoutine.taskIds.forEach { completeTask(doomed, "today", it).andExpect(status().isOk) }
        finishRoutine(doomed, "today", doomedRoutine.routineId).andExpect(status().isOk)
        val spare = fixtures.createSticker(doomed, doomedRoutine.routineId, today.minusDays(1), StickerStatus.AVAILABLE, designs[0])
        send("POST", "/api/children/$doomed/prize-requests", """{"stickerIds":[$spare]}""").andExpect(status().isCreated)

        // the sibling has the same kinds of rows
        siblingRoutine.taskIds.forEach { completeTask(sibling, "today", it).andExpect(status().isOk) }
        finishRoutine(sibling, "today", siblingRoutine.routineId).andExpect(status().isOk)
        val siblingSpare = fixtures.createSticker(
            sibling,
            siblingRoutine.routineId,
            today.minusDays(1),
            StickerStatus.AVAILABLE,
            designs[1],
        )
        send("POST", "/api/children/$sibling/prize-requests", """{"stickerIds":[$siblingSpare]}""").andExpect(status().isCreated)

        // the doomed child has a revoked sticker (a revocation row must exist)
        val revoked = fixtures.createRoutine(doomed, name = "Revoked")
        val revokedSticker = fixtures.createSticker(doomed, revoked.routineId, today.minusDays(2), StickerStatus.REVOKED, designs[2])
        jdbc.sql(
            "INSERT INTO sticker_revocation (sticker_id, child_id, chart_date, task_id, task_label, from_status, revoked_at) " +
                "VALUES (?, ?, ?, ?, 'Brush teeth', 'AVAILABLE', UTC_TIMESTAMP(3))",
        ).params(revokedSticker, doomed, today.minusDays(2), revoked.taskIds[0]).update()

        val doomedBefore = rowsFor(doomed, doomedRoutine.routineId)
        val siblingBefore = rowsFor(sibling, siblingRoutine.routineId)
        assertThat(doomedBefore.values).allMatch { it > 0 }

        send("DELETE", "/api/parent/children/$doomed", null, parent).andExpect(status().isNoContent)

        assertThat(rowsFor(doomed, doomedRoutine.routineId).values).containsOnly(0L)
        assertThat(rowsFor(sibling, siblingRoutine.routineId)).isEqualTo(siblingBefore)
        fetch("/api/children/$doomed/stickers").andExpect(status().isNotFound)
        fetch("/api/parent/children", parent).andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(sibling))
        fetch("/api/children/$sibling/stickers").andExpect(jsonPath("$.counts.pending").value(1))
    }

    private fun choreRowsFor(childId: Long): Map<String, Long> = mapOf(
        "chore" to count("SELECT COUNT(*) FROM chore WHERE child_id = ?", childId),
        "chore_task" to count("SELECT COUNT(*) FROM chore_task WHERE chore_id IN (SELECT id FROM chore WHERE child_id = ?)", childId),
        "chore sticker" to count("SELECT COUNT(*) FROM sticker WHERE child_id = ? AND source = 'CHORE'", childId),
        "chore sticker_pick_choice" to count(
            "SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id IN (SELECT id FROM sticker WHERE child_id = ? AND source = 'CHORE')",
            childId,
        ),
        "chore sticker_revocation" to count(
            "SELECT COUNT(*) FROM sticker_revocation WHERE child_id = ? AND sticker_id IN (SELECT id FROM sticker WHERE source = 'CHORE')",
            childId,
        ),
    )

    private fun giveChores(childId: Long, designs: List<Long>) {
        // one finished through the API and left in the tray, one claimed, one revoked with its revocation, one still to do, one removed
        val tray = fixtures.createChore(childId, name = "Tray", checked = setOf(0, 1))
        send("POST", "/api/children/$childId/chores/${tray.choreId}/finish").andExpect(status().isOk)
        val claimed = fixtures.createChore(childId, name = "Claimed", checked = setOf(0, 1))
        fixtures.createChoreSticker(childId, claimed.choreId, today.minusDays(1), StickerStatus.AVAILABLE, designId = designs[0])
        val revoked = fixtures.createChore(childId, name = "Revoked", checked = setOf(0))
        val revokedSticker = fixtures.createChoreSticker(
            childId,
            revoked.choreId,
            today.minusDays(2),
            StickerStatus.REVOKED,
            designId = designs[1],
            choices = designs.take(3),
        )
        jdbc.sql(
            "INSERT INTO sticker_revocation (sticker_id, child_id, chart_date, task_id, task_label, from_status, revoked_at) " +
                "VALUES (?, ?, ?, NULL, 'Books on the shelf', 'AVAILABLE', UTC_TIMESTAMP(3))",
        ).params(revokedSticker, childId, today.minusDays(2)).update()
        fixtures.createChore(childId, name = "To do", dueDate = today.plusDays(2), checked = setOf(0))
        fixtures.createChore(childId, name = "Removed", removed = true)
    }

    @Test
    fun `deleting a child removes its chores, their tasks, chore stickers and revocations and leaves a sibling's alone`() {
        val parent = seededParent()
        val designs = fixtures.activeDesignIds()
        val doomed = fixtures.createChild("Jane Doe")
        val sibling = fixtures.createChild("Sam Roe")
        giveChores(doomed, designs)
        giveChores(sibling, designs)

        val doomedBefore = choreRowsFor(doomed)
        val siblingBefore = choreRowsFor(sibling)
        assertThat(doomedBefore.values).allMatch { it > 0 }
        assertThat(doomedBefore["chore"]).isEqualTo(5L)

        send("DELETE", "/api/parent/children/$doomed", null, parent).andExpect(status().isNoContent)

        assertThat(choreRowsFor(doomed).values).containsOnly(0L)
        assertThat(count("SELECT COUNT(*) FROM chore WHERE child_id = ?", doomed)).isZero()
        assertThat(choreRowsFor(sibling)).isEqualTo(siblingBefore)
        fetch("/api/children/$doomed/days/today").andExpect(status().isNotFound)
        fetch("/api/parent/chores?filter=active", parent).andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].childId").value(sibling))
        fetch("/api/parent/chores?filter=closed", parent).andExpect(jsonPath("$.items.length()").value(2))
    }
}
