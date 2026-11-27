package com.stickerbank.chart

import com.stickerbank.chore.ChoreApi
import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

/** Routine reads ignore a chore sticker, and the tray includes it (TDD 7.3, 7.9, 13). */
@IntegrationTest
class ChoreStickerChartIT : FlowTestBase() {
    private lateinit var api: ChoreApi
    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    @BeforeEach
    fun setUp() {
        childId = fixtures.createChild("Jane Doe")
        api = ChoreApi(mvc, fixtures)
    }

    @Test
    fun `a chore sticker does not make a routine earned, on today's chart or in history`() {
        val routine = fixtures.createRoutine(childId)
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val design = fixtures.activeDesignIds().first()
        fixtures.createChoreSticker(childId, chore.choreId, today, StickerStatus.AVAILABLE, designId = design)
        val oldChore = fixtures.createChore(childId, name = "Old chore", checked = setOf(0, 1))
        fixtures.createChoreSticker(
            childId,
            oldChore.choreId,
            yesterday,
            StickerStatus.AVAILABLE,
            designId = design,
            choreName = "Old chore",
        )

        api.chart(childId, asParent = true).andExpect(status().isOk)
            .andExpect(jsonPath("$.routines.length()").value(1))
            .andExpect(jsonPath("$.routines[0].routineId").value(routine.routineId))
            .andExpect(jsonPath("$.routines[0].state").value("NOT_STARTED"))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
            .andExpect(jsonPath("$.chores.length()").value(1))
            .andExpect(jsonPath("$.chores[0].state").value("EARNED"))
        api.chart(childId, yesterday.toString(), asParent = true).andExpect(jsonPath("$.routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
            .andExpect(jsonPath("$.chores[0].name").value("Old chore"))

        val history = read(api.history(childId, yesterday.toString(), today.toString()).andExpect(status().isOk))
        // look the days up by date, whatever their order
        listOf(today, yesterday).forEach { date ->
            val day = com.jayway.jsonpath.JsonPath.read<List<Map<String, Any?>>>(history, "$.days[?(@.date == '$date')]").single()

            @Suppress("UNCHECKED_CAST")
            val routines = day["routines"] as List<Map<String, Any?>>
            assertThat(routines).hasSize(1)
            assertThat(routines[0]["stickerId"]).isNull()
            assertThat(routines[0]["state"]).isIn("NOT_STARTED", "MISSED")
            @Suppress("UNCHECKED_CAST")
            assertThat(day["chores"] as List<Map<String, Any?>>).hasSize(1)
        }
        assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?", routine.routineId)).isZero()
    }

    @Test
    fun `a routine and a chore finished the same day each keep their own sticker`() {
        val routine = fixtures.createRoutine(childId)
        routine.taskIds.forEach { completeTask(childId, "today", it).andExpect(status().isOk) }
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val choreFinish = read(api.finish(childId, chore.choreId).andExpect(status().isOk))
        val routineFinish = read(finishRoutine(childId, "today", routine.routineId).andExpect(status().isOk))
        assertThat(long(routineFinish, "$.pick.stickerId")).isNotEqualTo(long(choreFinish, "$.pick.stickerId"))
        assertThat(
            count("SELECT COUNT(*) FROM live_sticker WHERE child_id = ? AND source = 'ROUTINE' AND chart_date = ?", childId, today),
        ).isEqualTo(1)
        assertThat(
            count("SELECT COUNT(*) FROM live_sticker WHERE child_id = ? AND source = 'CHORE' AND chart_date = ?", childId, today),
        ).isEqualTo(1)
        api.chart(childId).andExpect(jsonPath("$.routines[0].state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.chores[0].state").value("AWAITING_PICK"))
    }

    @Test
    fun `the unclaimed tray lists a chore sticker from an earlier day with the chore's name and icon`() {
        val chore = fixtures.createChore(childId, name = "Feed the fish", iconKey = "fish", checked = setOf(0, 1))
        val designs = fixtures.activeDesignIds().take(3)
        val sticker = fixtures.createChoreSticker(
            childId,
            chore.choreId,
            yesterday,
            StickerStatus.UNCLAIMED,
            choreName = "Feed the fish",
            choreIconKey = "fish",
            choices = designs,
        )
        api.chart(childId).andExpect(status().isOk)
            .andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(1))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].stickerId").value(sticker))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].chartDate").value(yesterday.toString()))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].routineName").value("Feed the fish"))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].routineIconKey").value("fish"))
        // it can be picked from the tray
        val pick = read(fetch("/api/stickers/$sticker/pick").andExpect(status().isOk))
        assertThat(longs(pick, "$.choices[*].designId")).containsExactlyElementsOf(designs)
        claim(sticker, designs[0]).andExpect(status().isOk)
        api.chart(childId).andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
    }
}
