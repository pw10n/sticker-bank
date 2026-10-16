package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Duration

@IntegrationTest
class RoutineEditFlowIT : FlowTestBase() {
    @Test
    fun `edit after earning applies from tomorrow (BR-2)`() {
        val parent = setupParent()
        val childId = createChildViaApi(parent)
        val routine = createRoutineViaApi(parent, childId, "Morning Routine")
        routine.taskIds.forEach { completeTask(childId, "today", it).andExpect(status().isOk) }

        val body =
            """{"name":"Renamed Routine","iconKey":"sun","color":null,"tasks":[""" +
                """{"id":${routine.taskIds[0]},"label":"Brush teeth","iconKey":"toothbrush"},""" +
                """{"id":${routine.taskIds[1]},"label":"Get dressed","iconKey":"toothbrush"},""" +
                """{"label":"Pack bag","iconKey":"toothbrush"}]}"""
        send("PUT", "/api/parent/routines/${routine.id}", body, parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.appliesFromTomorrow").value(true))
            .andExpect(jsonPath("$.effectiveFrom").value("2026-10-16"))
            .andExpect(jsonPath("$.earnedPick").doesNotExist())

        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
            .andExpect(jsonPath("$.routines[0].name").value("Morning Routine"))
            .andExpect(jsonPath("$.routines[0].taskCount").value(2))
            .andExpect(jsonPath("$.routines[0].state").value("AWAITING_PICK"))

        clock.advance(Duration.ofDays(1))
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
            .andExpect(jsonPath("$.date").value("2026-10-16"))
            .andExpect(jsonPath("$.routines[0].name").value("Renamed Routine"))
            .andExpect(jsonPath("$.routines[0].taskCount").value(3))
            .andExpect(jsonPath("$.routines[0].state").value("NOT_STARTED"))
    }

    @Test
    fun `removing the last unfinished task earns the sticker (I-3)`() {
        val parent = setupParent()
        val childId = createChildViaApi(parent)
        val routine = createRoutineViaApi(parent, childId)
        completeTask(childId, "today", routine.taskIds[0]).andExpect(status().isOk)

        val body = """{"name":"Morning Routine","iconKey":"sun","color":null,"tasks":[""" +
            """{"id":${routine.taskIds[0]},"label":"Brush teeth","iconKey":"toothbrush"}]}"""
        val saved = read(
            send("PUT", "/api/parent/routines/${routine.id}", body, parent).andExpect(status().isOk)
                .andExpect(jsonPath("$.appliesFromTomorrow").value(false))
                .andExpect(jsonPath("$.earnedPick").isNotEmpty),
        )
        val stickerId = long(saved, "$.earnedPick.stickerId")
        assertThat(longs(saved, "$.earnedPick.choices[*].designId")).hasSize(3).doesNotHaveDuplicates()
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE routine_id = ?", routine.id)).isEqualTo(1)

        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.routines[0].state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.routines[0].sticker.stickerId").value(stickerId))
    }
}
