package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Duration
import java.time.Instant

@IntegrationTest
class DayRolloverFlowIT : FlowTestBase() {
    @Test
    fun `the family day rolls over at local midnight (FR-4-4, TD-9)`() {
        val parent = seededParent()
        val childId = fixtures.createChild("Jane Doe")
        val routine = fixtures.createRoutine(childId)
        send(
            "PUT",
            "/api/parent/settings",
            """{"timeZone":"America/New_York","parentIdleTimeoutSeconds":300}""",
            parent,
        ).andExpect(status().isOk).andExpect(jsonPath("$.timeZone").value("America/New_York"))

        // 23:59 on 15 Oct in New York (EDT, UTC-4)
        clock.set(Instant.parse("2026-10-16T03:59:00Z"))
        val before = read(fetch("/api/bootstrap").andExpect(status().isOk))
        assertThat(text(before, "$.today")).isEqualTo("2026-10-15")
        assertThat(text(before, "$.timeZone")).isEqualTo("America/New_York")
        val nextBefore = Instant.parse(text(before, "$.nextDayStartsAt"))
        assertThat(nextBefore).isEqualTo(Instant.parse("2026-10-16T04:00:00Z"))

        clock.advance(Duration.ofMinutes(2))
        val after = read(fetch("/api/bootstrap").andExpect(status().isOk))
        assertThat(text(after, "$.today")).isEqualTo("2026-10-16")
        val nextAfter = Instant.parse(text(after, "$.nextDayStartsAt"))
        assertThat(nextAfter).isAfter(nextBefore).isEqualTo(Instant.parse("2026-10-17T04:00:00Z"))

        completeTask(childId, "2026-10-15", routine.taskIds[0])
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DAY_CHANGED"))
            .andExpect(jsonPath("$.today").value("2026-10-16"))
        assertThat(count("SELECT COUNT(*) FROM task_completion WHERE child_id = ?", childId)).isZero()
        completeTask(childId, "today", routine.taskIds[0]).andExpect(status().isOk)
    }
}
