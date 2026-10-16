package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** PIN -> child -> routine -> earn -> claim -> parent revokes -> book empty -> re-earn -> claim -> history (FDD 6.12). */
@IntegrationTest
class RevocationFlowIT : FlowTestBase() {
    @Test
    fun `a parent revokes an earned sticker and the child earns it again`() {
        val parent = setupParent()
        val childId = createChildViaApi(parent)
        val routine = createRoutineViaApi(parent, childId)

        // the child finishes the routine and claims the sticker
        completeTask(childId, "today", routine.taskIds[0]).andExpect(status().isOk)
        completeTask(childId, "today", routine.taskIds[1]).andExpect(status().isOk)
        val earned = read(finishRoutine(childId, "today", routine.id).andExpect(status().isOk))
        val firstSticker = long(earned, "$.pick.stickerId")
        claim(firstSticker, long(earned, "$.pick.choices[0].designId")).andExpect(status().isOk)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))

        // the child cannot undo; the parent must confirm
        send("DELETE", "/api/children/$childId/days/today/tasks/${routine.taskIds[1]}")
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
        send("DELETE", "/api/children/$childId/days/today/tasks/${routine.taskIds[1]}", null, parent)
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("REVOKE_CONFIRMATION_REQUIRED"))
            .andExpect(jsonPath("$.sticker.stickerId").value(firstSticker))

        // the parent revokes with a note
        val revokePath = "/api/children/$childId/days/today/tasks/${routine.taskIds[1]}?revokeSticker=true"
        send("DELETE", revokePath, """{"note":"Not really done"}""", parent)
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.stickerId").value(firstSticker))
            .andExpect(jsonPath("$.revoked.fromStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.items.length()").value(0))
            .andExpect(jsonPath("$.counts.available").value(0))

        // the child taps the task again: the routine is only Ready to finish until I'm Done! (FR-12.5)
        completeTask(childId, "today", routine.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        val again = read(finishRoutine(childId, "today", routine.id).andExpect(status().isOk))
        val secondSticker = long(again, "$.pick.stickerId")
        assertThat(secondSticker).isNotEqualTo(firstSticker)
        // FR-12.5: the same three choices are offered again, in the same order
        assertThat(longs(again, "$.pick.choices[*].designId"))
            .hasSize(3)
            .containsExactlyElementsOf(longs(earned, "$.pick.choices[*].designId"))
        claim(secondSticker, long(again, "$.pick.choices[1].designId")).andExpect(status().isOk)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].stickerId").value(secondSticker))
            .andExpect(jsonPath("$.counts.available").value(1))

        // history lists the revocation with its note
        fetch("/api/parent/children/$childId/history?from=today&to=today", parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.days[0].routines[0].state").value("EARNED"))
            .andExpect(jsonPath("$.days[0].routines[0].stickerId").value(secondSticker))
            .andExpect(jsonPath("$.days[0].revocations.length()").value(1))
            .andExpect(jsonPath("$.days[0].revocations[0].stickerId").value(firstSticker))
            .andExpect(jsonPath("$.days[0].revocations[0].note").value("Not really done"))
        assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?", routine.id)).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE routine_id = ?", routine.id)).isEqualTo(2)
    }
}
