package com.stickerbank.prize

import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

/** A Prize Request can be made of chore stickers alone, and completed (TDD 13). */
@IntegrationTest
class ChoreStickerPrizeIT : FlowTestBase() {
    private val today = LocalDate.of(2026, 10, 15)

    private fun choreSticker(childId: Long, name: String, daysAgo: Long, design: Long): Long {
        val chore = fixtures.createChore(childId, name = name, checked = setOf(0, 1))
        return fixtures.createChoreSticker(
            childId,
            chore.choreId,
            today.minusDays(daysAgo),
            StickerStatus.AVAILABLE,
            designId = design,
            choreName = name,
        )
    }

    @Test
    fun `a prize request made only of chore stickers is created, completed, and the stickers are used`() {
        val parent = seededParent()
        val childId = fixtures.createChild()
        val designs = fixtures.activeDesignIds()
        val one = choreSticker(childId, "Feed the fish", 1, designs[0])
        val two = choreSticker(childId, "Water the plants", 2, designs[1])

        val created = read(
            send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[$one,$two]}""").andExpect(status().isCreated)
                .andExpect(jsonPath("$.status").value("PENDING")).andExpect(jsonPath("$.stickerCount").value(2)),
        )
        val request = long(created, "$.id")
        assertThat(longs(created, "$.stickers[*].stickerId")).containsExactlyInAnyOrder(one, two)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.pending").value(2))
            .andExpect(jsonPath("$.counts.available").value(0))
        fetch("/api/children/$childId/prize-requests/pending").andExpect(jsonPath("$.request.id").value(request))

        send("POST", "/api/parent/prize-requests/$request/complete", """{"prizeText":"Ice cream"}""", parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("COMPLETED"))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.used").value(2))
            .andExpect(jsonPath("$.counts.pending").value(0))
        fetch("/api/stickers/$one").andExpect(jsonPath("$.status").value("USED"))
            .andExpect(jsonPath("$.prize.prizeText").value("Ice cream"))
        fetch("/api/parent/prize-requests?status=COMPLETED", parent).andExpect(jsonPath("$.items.length()").value(1))
    }

    @Test
    fun `a prize request can mix routine and chore stickers and a chore sticker can be cancelled back`() {
        val childId = fixtures.createChild()
        val routine = fixtures.createRoutine(childId)
        val designs = fixtures.activeDesignIds()
        val routineSticker = fixtures.createSticker(childId, routine.routineId, today.minusDays(4), StickerStatus.AVAILABLE, designs[0])
        val choreSticker = choreSticker(childId, "Feed the fish", 1, designs[1])
        val created = read(
            send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[$routineSticker,$choreSticker]}""")
                .andExpect(status().isCreated),
        )
        val request = long(created, "$.id")
        send("POST", "/api/prize-requests/$request/cancel").andExpect(status().isOk)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(2))
            .andExpect(jsonPath("$.counts.pending").value(0))
    }
}
