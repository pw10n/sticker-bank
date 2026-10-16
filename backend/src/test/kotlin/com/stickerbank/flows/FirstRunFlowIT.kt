package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@IntegrationTest
class FirstRunFlowIT : FlowTestBase() {
    @Test
    fun `first run to earned and booked sticker`() {
        fetch("/api/bootstrap").andExpect(jsonPath("$.setupRequired").value(true))
        val parent = setupParent("1234", "UTC")
        fetch("/api/bootstrap").andExpect(jsonPath("$.setupRequired").value(false))

        val childId = createChildViaApi(parent, "Jane Doe")
        val routine = createRoutineViaApi(parent, childId)
        assertThat(routine.taskIds).hasSize(2)

        // the child acts without any parent cookie
        completeTask(childId, "today", routine.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        // FR-6.6: checking the last task only makes the routine Ready to finish. Nothing is earned yet.
        completeTask(childId, "today", routine.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isZero()

        // FR-6.8: I'm Done! earns the sticker and opens the pick
        val second = read(finishRoutine(childId, "today", routine.id).andExpect(status().isOk))
        assertThat(text(second, "$.routine.state")).isEqualTo("AWAITING_PICK")
        val stickerId = long(second, "$.pick.stickerId")
        val choices = longs(second, "$.pick.choices[*].designId")
        assertThat(choices).hasSize(3).doesNotHaveDuplicates()

        // BR-6: the saved choices never change
        val firstRead = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        val secondRead = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        assertThat(longs(firstRead, "$.choices[*].designId")).isEqualTo(choices)
        assertThat(longs(secondRead, "$.choices[*].designId")).isEqualTo(choices)

        claim(stickerId, choices[1]).andExpect(status().isOk).andExpect(jsonPath("$.status").value("AVAILABLE"))

        fetch("/api/children/$childId/stickers").andExpect(status().isOk)
            .andExpect(jsonPath("$.counts.available").value(1))
            .andExpect(jsonPath("$.counts.totalEarned").value(1))
            .andExpect(jsonPath("$.counts.unclaimed").value(0))
            .andExpect(jsonPath("$.items[0].design.designId").value(choices[1]))
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
            .andExpect(jsonPath("$.routines[0].state").value("EARNED"))
            .andExpect(jsonPath("$.routines[0].sticker.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.routines[0].sticker.design.designId").value(choices[1]))
    }
}
