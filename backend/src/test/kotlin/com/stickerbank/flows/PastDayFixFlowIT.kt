package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@IntegrationTest
class PastDayFixFlowIT : FlowTestBase() {
    @Test
    fun `parent finishes yesterday and the child claims the late sticker`() {
        val parent = seededParent()
        val childId = fixtures.createChild("Jane Doe")
        val routine = fixtures.createRoutine(childId)
        val yesterday = LocalDate.of(2026, 10, 14)
        fixtures.completeTask(childId, routine.routineId, routine.taskIds[0], yesterday)

        // FR-6.5 / I-2: a child can no longer change a past day
        completeTask(childId, yesterday.toString(), routine.taskIds[1])
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DAY_CHANGED"))
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isZero()

        // checking the last task of a past day leaves the routine Ready to finish (FR-6.5, TDD 7.12): the day has
        // already been settled, so it is not finished automatically
        completeTask(childId, yesterday.toString(), routine.taskIds[1], parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isZero()
        // the child cannot finish it either
        finishRoutine(childId, yesterday.toString(), routine.routineId)
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DAY_CHANGED"))

        val finished = read(finishRoutine(childId, yesterday.toString(), routine.routineId, parent).andExpect(status().isOk))
        val stickerId = long(finished, "$.pick.stickerId")
        assertThat(text(finished, "$.routine.state")).isEqualTo("AWAITING_PICK")
        assertThat(text(finished, "$.pick.chartDate")).isEqualTo("2026-10-14")
        val choices = longs(finished, "$.pick.choices[*].designId")

        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].stickerId").value(stickerId))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].chartDate").value("2026-10-14"))

        claim(stickerId, choices[0]).andExpect(status().isOk).andExpect(jsonPath("$.status").value("AVAILABLE"))
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.unclaimedFromEarlierDays").isEmpty)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))
    }
}
