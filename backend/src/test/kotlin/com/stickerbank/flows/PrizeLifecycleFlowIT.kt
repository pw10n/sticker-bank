package com.stickerbank.flows

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@IntegrationTest
class PrizeLifecycleFlowIT : FlowTestBase() {
    private fun seedAvailable(childId: Long, routineId: Long, designs: List<Long>, count: Int): List<Long> {
        val today = LocalDate.of(2026, 10, 15)
        return (1..count).map { n ->
            fixtures.createSticker(childId, routineId, today.minusDays(n.toLong()), StickerStatus.AVAILABLE, designs[n])
        }
    }

    @Test
    fun `request, complete and history, then request and cancel`() {
        val parent = seededParent()
        val childId = fixtures.createChild("Jane Doe")
        val routine = fixtures.createRoutine(childId)
        val stickers = seedAvailable(childId, routine.routineId, fixtures.activeDesignIds(), 3)

        // the child asks for a prize with two stickers
        val created = read(
            send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[${stickers[0]},${stickers[1]}]}""")
                .andExpect(status().isCreated),
        )
        val requestId = long(created, "$.id")
        assertThat(text(created, "$.status")).isEqualTo("PENDING")
        assertThat(text(created, "$.createdBy")).isEqualTo("CHILD")

        send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[${stickers[2]}]}""")
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("PENDING_REQUEST_EXISTS"))
        fetch("/api/children/$childId/prize-requests/pending").andExpect(status().isOk)
            .andExpect(jsonPath("$.request.id").value(requestId))

        // the parent sees it and completes it
        fetch("/api/parent/prize-requests?status=PENDING", parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.items[0].id").value(requestId))
            .andExpect(jsonPath("$.items[0].stickerCount").value(2))
        fetch("/api/bootstrap").andExpect(jsonPath("$.pendingPrizeRequestCount").value(1))
        send("POST", "/api/parent/prize-requests/$requestId/complete", """{"prizeText":"Ice cream after dinner"}""", parent)
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("COMPLETED"))

        fetch("/api/stickers/${stickers[0]}").andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("USED"))
            .andExpect(jsonPath("$.prize.prizeText").value("Ice cream after dinner"))
            .andExpect(jsonPath("$.prize.prizeRequestId").value(requestId))
        fetch("/api/stickers/${stickers[1]}").andExpect(jsonPath("$.status").value("USED"))
        fetch("/api/parent/prize-requests?status=COMPLETED", parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.items[0].id").value(requestId))
            .andExpect(jsonPath("$.items[0].prizeText").value("Ice cream after dinner"))
        fetch("/api/parent/prize-requests?status=PENDING", parent).andExpect(jsonPath("$.items").isEmpty)
        fetch("/api/bootstrap").andExpect(jsonPath("$.pendingPrizeRequestCount").value(0))

        // a second request, cancelled by the child, frees the sticker again
        val second = read(
            send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[${stickers[2]}]}""").andExpect(status().isCreated),
        )
        val secondId = long(second, "$.id")
        fetch("/api/stickers/${stickers[2]}").andExpect(jsonPath("$.status").value("PENDING"))
        send("POST", "/api/prize-requests/$secondId/cancel").andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("CANCELLED"))
            .andExpect(jsonPath("$.cancelledBy").value("CHILD"))
        fetch("/api/stickers/${stickers[2]}").andExpect(jsonPath("$.status").value("AVAILABLE"))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))
            .andExpect(jsonPath("$.counts.used").value(2))
            .andExpect(jsonPath("$.counts.pending").value(0))
    }
}
