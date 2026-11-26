package com.stickerbank.chore

import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

/** Chores on the chart and in History (TDD 7.3, FR-13.13, FR-13.18, FR-13.26). */
@IntegrationTest
class ChoreChartIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: MutableClock

    private lateinit var api: ChoreApi
    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        childId = fixtures.createChild("Jane Doe")
        api = ChoreApi(mvc, fixtures)
    }

    private fun names(path: String, date: String = "today", parent: Boolean = false): List<String> =
        api.chart(childId, date, parent).andExpect(status().isOk).read(path)

    private fun at(hour: Int) = LocalDateTime.of(2026, 10, 10, hour, 0)

    private fun design() = fixtures.activeDesignIds().first()

    @Test
    fun `today lists every unfinished chore oldest first, a new one last`() {
        fixtures.createChore(childId, name = "Second", createdAt = at(10))
        fixtures.createChore(childId, name = "First", createdAt = at(9))
        fixtures.createChore(childId, name = "Due later", dueDate = today.plusDays(5), createdAt = at(11))
        api.assign(childId, api.body(name = "Newest")).andExpect(status().isCreated)
        assertThat(names("$.chores[*].name")).containsExactly("First", "Second", "Due later", "Newest")
    }

    @Test
    fun `chore cards carry progress, tasks and a derived state`() {
        fixtures.createChore(childId, name = "Started", checked = setOf(0), createdAt = at(9))
        fixtures.createChore(childId, name = "Ready", checked = setOf(0, 1), createdAt = at(10))
        fixtures.createChore(childId, name = "Fresh", createdAt = at(11))
        api.chart(childId).andExpect(status().isOk)
            .andExpect(jsonPath("$.chores[0].state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.chores[0].doneCount").value(1))
            .andExpect(jsonPath("$.chores[0].taskCount").value(2))
            .andExpect(jsonPath("$.chores[0].tasks[0].done").value(true))
            .andExpect(jsonPath("$.chores[0].tasks[1].done").value(false))
            .andExpect(jsonPath("$.chores[1].state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.chores[2].state").value("NOT_STARTED"))
    }

    @Test
    fun `a chore finished today stays on today, one finished yesterday is on yesterday only`() {
        val a = fixtures.createChore(childId, name = "Today", checked = setOf(0, 1), createdAt = at(9))
        fixtures.createChoreSticker(childId, a.choreId, today, StickerStatus.UNCLAIMED)
        val b = fixtures.createChore(childId, name = "Yesterday", checked = setOf(0, 1), createdAt = at(10))
        fixtures.createChoreSticker(childId, b.choreId, yesterday, StickerStatus.AVAILABLE, designId = design())
        assertThat(names("$.chores[*].name")).containsExactly("Today")
        api.chart(childId).andExpect(jsonPath("$.chores[0].state").value("AWAITING_PICK"))
        assertThat(names("$.chores[*].name", yesterday.toString())).containsExactly("Yesterday")
        api.chart(childId, yesterday.toString()).andExpect(jsonPath("$.chores[0].state").value("EARNED"))
            .andExpect(jsonPath("$.chores[0].sticker.design.designId").value(design()))
    }

    @Test
    fun `a missed chore is on its due date only, not on today and not on other past days`() {
        fixtures.createChore(childId, name = "Late", dueDate = yesterday, checked = setOf(0))
        assertThat(names("$.chores[*].name")).isEmpty()
        assertThat(names("$.chores[*].name", yesterday.toString())).containsExactly("Late")
        api.chart(childId, yesterday.toString()).andExpect(jsonPath("$.chores[0].state").value("MISSED"))
            .andExpect(jsonPath("$.chores[0].doneCount").value(1))
        assertThat(names("$.chores[*].name", today.minusDays(2).toString())).isEmpty()
    }

    @Test
    fun `an unfinished chore is not on a past day`() {
        fixtures.createChore(childId, name = "Open")
        assertThat(names("$.chores[*].name", yesterday.toString())).isEmpty()
    }

    @Test
    fun `a revoked chore is back on the chart, missed when its due date has passed`() {
        val open = fixtures.createChore(childId, name = "No due", checked = setOf(0), createdAt = at(9))
        fixtures.createChoreSticker(childId, open.choreId, yesterday, StickerStatus.REVOKED)
        val late = fixtures.createChore(childId, name = "Late", dueDate = yesterday, checked = setOf(0), createdAt = at(10))
        fixtures.createChoreSticker(childId, late.choreId, yesterday, StickerStatus.REVOKED)
        assertThat(names("$.chores[*].name")).containsExactly("No due")
        assertThat(names("$.chores[*].name", yesterday.toString())).containsExactly("Late")
    }

    @Test
    fun `removed chores and other children's chores are not shown`() {
        fixtures.createChore(childId, name = "Gone", removed = true)
        val other = fixtures.createChild("John Doe")
        fixtures.createChore(other, name = "His")
        fixtures.createChore(childId, name = "Mine")
        assertThat(names("$.chores[*].name")).containsExactly("Mine")
    }

    @Test
    fun `sticker parent fields are only filled in Parent view`() {
        val f = fixtures.createChore(childId, checked = setOf(0, 1))
        fixtures.createChoreSticker(childId, f.choreId, today, StickerStatus.AVAILABLE, designId = design(), finishMode = FinishMode.AUTO)
        api.chart(childId).andExpect(jsonPath("$.chores[0].sticker.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.chores[0].sticker.revocable").doesNotExist())
            .andExpect(jsonPath("$.chores[0].sticker.autoFinished").doesNotExist())
        api.chart(childId, asParent = true)
            .andExpect(jsonPath("$.chores[0].sticker.revocable").value(true))
            .andExpect(jsonPath("$.chores[0].sticker.autoFinished").value(true))
    }

    @Test
    fun `a used sticker is not revocable in Parent view`() {
        val f = fixtures.createChore(childId, checked = setOf(0, 1))
        fixtures.createChoreSticker(childId, f.choreId, today, StickerStatus.USED, designId = design(), finishMode = FinishMode.TAPPED)
        api.chart(childId, asParent = true).andExpect(jsonPath("$.chores[0].sticker.revocable").value(false))
            .andExpect(jsonPath("$.chores[0].sticker.autoFinished").value(false))
    }

    @Test
    fun `history shows chores finished or missed on each day and today's open ones`() {
        val done = fixtures.createChore(childId, name = "Done", checked = setOf(0, 1), createdAt = at(9))
        val stickerId = fixtures.createChoreSticker(
            childId,
            done.choreId,
            yesterday,
            StickerStatus.AVAILABLE,
            designId = design(),
            finishMode = FinishMode.AUTO,
        )
        fixtures.createChore(childId, name = "Late", dueDate = yesterday, checked = setOf(0), createdAt = at(10))
        fixtures.createChore(childId, name = "Open", createdAt = at(11))
        val json = api.history(childId, yesterday.toString(), today.toString()).andExpect(status().isOk).json()
        val y = "$.days[?(@.date=='$yesterday')].chores[*]"
        assertThat(com.jayway.jsonpath.JsonPath.read<List<String>>(json, "$y.name")).containsExactly("Done", "Late")
        assertThat(com.jayway.jsonpath.JsonPath.read<List<String>>(json, "$y.state")).containsExactly("EARNED", "MISSED")
        assertThat(com.jayway.jsonpath.JsonPath.read<List<Int?>>(json, "$y.stickerId")).containsExactly(stickerId.toInt(), null)
        assertThat(com.jayway.jsonpath.JsonPath.read<List<Boolean>>(json, "$y.autoFinished")).containsExactly(true, false)
        assertThat(
            com.jayway.jsonpath.JsonPath.read<List<String>>(json, "$.days[?(@.date=='$today')].chores[*].name"),
        ).containsExactly("Open")
    }
}
