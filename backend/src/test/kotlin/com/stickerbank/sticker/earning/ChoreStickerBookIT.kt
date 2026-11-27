package com.stickerbank.sticker.earning

import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import org.hamcrest.Matchers.hasSize
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

/** A chore sticker is in the Sticker Book and its counts, and its designs cannot be deleted (TDD 13). */
@IntegrationTest
class ChoreStickerBookIT : FlowTestBase() {
    private val today = LocalDate.of(2026, 10, 15)

    @Test
    fun `the Sticker Book and its counts include chore stickers next to routine ones`() {
        val childId = fixtures.createChild()
        val routine = fixtures.createRoutine(childId)
        val designs = fixtures.activeDesignIds()
        fixtures.createSticker(childId, routine.routineId, today.minusDays(3), StickerStatus.AVAILABLE, designs[0])
        val chore = fixtures.createChore(childId, name = "Feed the fish", checked = setOf(0, 1))
        val sticker = fixtures.createChoreSticker(
            childId,
            chore.choreId,
            today.minusDays(1),
            StickerStatus.AVAILABLE,
            designId = designs[1],
            choreName = "Feed the fish",
        )
        val tray = fixtures.createChore(childId, name = "Water the plants", checked = setOf(0, 1))
        fixtures.createChoreSticker(
            childId,
            tray.choreId,
            today,
            StickerStatus.UNCLAIMED,
            choreName = "Water the plants",
            choices = designs.take(3),
        )
        val used = fixtures.createChore(childId, name = "Sweep", checked = setOf(0, 1))
        fixtures.createChoreSticker(
            childId,
            used.choreId,
            today.minusDays(2),
            StickerStatus.USED,
            designId = designs[2],
            choreName = "Sweep",
        )

        fetch("/api/children/$childId/stickers").andExpect(status().isOk)
            .andExpect(jsonPath("$.counts.available").value(2))
            .andExpect(jsonPath("$.counts.used").value(1))
            .andExpect(jsonPath("$.counts.unclaimed").value(1))
            .andExpect(jsonPath("$.counts.totalEarned").value(3))
            .andExpect(jsonPath("$.items[?(@.stickerId == $sticker)].source").value("CHORE"))
            .andExpect(jsonPath("$.items[?(@.stickerId == $sticker)].routineName").value("Feed the fish"))
            .andExpect(jsonPath("$.items[?(@.source == 'CHORE')].stickerId", hasSize<Any>(2)))
        fetch("/api/children/$childId/stickers?status=AVAILABLE")
            .andExpect(jsonPath("$.items.length()").value(2))
        fetch("/api/stickers/$sticker").andExpect(status().isOk)
            .andExpect(jsonPath("$.source").value("CHORE"))
            .andExpect(jsonPath("$.routineName").value("Feed the fish"))
    }

    @Test
    fun `a design offered only by a chore sticker's choices cannot be deleted`() {
        val parent = seededParent()
        val childId = fixtures.createChild()
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val designs = fixtures.activeDesignIds().take(3)
        fixtures.createChoreSticker(childId, chore.choreId, today, StickerStatus.UNCLAIMED, choices = designs)
        send("DELETE", "/api/parent/library/designs/${designs[0]}", null, parent)
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
        // a design that was claimed on a chore sticker is in use too
        val claimed = fixtures.activeDesignIds()[5]
        val other = fixtures.createChore(childId, name = "Other", checked = setOf(0, 1))
        fixtures.createChoreSticker(childId, other.choreId, today.minusDays(1), StickerStatus.AVAILABLE, designId = claimed)
        send("DELETE", "/api/parent/library/designs/$claimed", null, parent)
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
        // an unused design can still be deleted
        send("DELETE", "/api/parent/library/designs/${fixtures.activeDesignIds()[8]}", null, parent).andExpect(status().isNoContent)
    }
}
