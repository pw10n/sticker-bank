package com.stickerbank.chore

import com.jayway.jsonpath.JsonPath
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

/** The parent's chore lists and suggestions (TDD 7.13 "Listing", FR-13.7, FR-13.8, I-37). */
@IntegrationTest
class ChoreListIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: MutableClock

    private lateinit var api: ChoreApi
    private var janeId = 0L
    private var johnId = 0L
    private val today = LocalDate.of(2026, 10, 15)

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        janeId = fixtures.createChild("Jane Doe")
        johnId = fixtures.createChild("John Doe")
        api = ChoreApi(mvc, fixtures)
    }

    private fun at(day: Int, hour: Int = 9) = LocalDateTime.of(2026, 10, day, hour, 0)

    private fun finished(child: Long, name: String, date: LocalDate, createdAt: LocalDateTime = at(1)): Long {
        val f = fixtures.createChore(child, name = name, checked = setOf(0, 1), createdAt = createdAt)
        fixtures.createChoreSticker(child, f.choreId, date, StickerStatus.AVAILABLE, designId = fixtures.activeDesignIds().first())
        return f.choreId
    }

    private fun names(query: String): List<String> = api.list(query).andExpect(status().isOk).read("$.items[*].name")

    // ---- active

    @Test
    fun `active lists unfinished chores child by child in chart order`() {
        fixtures.createChore(johnId, name = "John 1", createdAt = at(1))
        fixtures.createChore(janeId, name = "Jane 2", createdAt = at(3))
        fixtures.createChore(janeId, name = "Jane 1", createdAt = at(2), checked = setOf(0, 1))
        fixtures.createChore(janeId, name = "Jane due", dueDate = today, createdAt = at(4))
        assertThat(names("filter=active")).containsExactly("Jane 1", "Jane 2", "Jane due", "John 1")
        api.list("filter=active").andExpect(jsonPath("$.nextCursor").doesNotExist())
            .andExpect(jsonPath("$.items[0].childId").value(janeId))
            .andExpect(jsonPath("$.items[0].state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.items[0].closedOn").doesNotExist())
            .andExpect(jsonPath("$.items[0].createdAt").exists())
            .andExpect(jsonPath("$.items[0].tasks.length()").value(2))
    }

    @Test
    fun `active leaves out finished, missed and removed chores`() {
        fixtures.createChore(janeId, name = "Open")
        finished(janeId, "Done", today)
        fixtures.createChore(janeId, name = "Late", dueDate = today.minusDays(1))
        fixtures.createChore(janeId, name = "Gone", removed = true)
        assertThat(names("filter=active")).containsExactly("Open")
    }

    @Test
    fun `child filter covers one child, an unknown child is 404`() {
        fixtures.createChore(janeId, name = "Jane")
        fixtures.createChore(johnId, name = "John")
        finished(johnId, "John done", today)
        assertThat(names("filter=active&childId=$johnId")).containsExactly("John")
        assertThat(names("filter=closed&childId=$johnId")).containsExactly("John done")
        assertThat(names("filter=closed&childId=$janeId")).isEmpty()
        api.list("filter=active&childId=${johnId + 999}").andExpect(status().isNotFound)
    }

    @Test
    fun `an unknown filter or a bad cursor is a validation error on that field`() {
        api.list("filter=all").andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("filter"))
        api.list("filter=closed&cursor=%21%21").andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("cursor"))
    }

    // ---- closed

    @Test
    fun `closed lists finished and recently missed chores newest first with closedOn and the parent sticker fields`() {
        finished(janeId, "Done 3 days ago", today.minusDays(3))
        finished(janeId, "Done today", today)
        fixtures.createChore(janeId, name = "Missed 2 days ago", dueDate = today.minusDays(2))
        assertThat(names("filter=closed")).containsExactly("Done today", "Missed 2 days ago", "Done 3 days ago")
        api.list("filter=closed")
            .andExpect(jsonPath("$.items[0].state").value("EARNED"))
            .andExpect(jsonPath("$.items[0].closedOn").value(today.toString()))
            .andExpect(jsonPath("$.items[0].sticker.revocable").value(true))
            .andExpect(jsonPath("$.items[0].sticker.autoFinished").value(false))
            .andExpect(jsonPath("$.items[1].state").value("MISSED"))
            .andExpect(jsonPath("$.items[1].closedOn").value(today.minusDays(2).toString()))
            .andExpect(jsonPath("$.nextCursor").doesNotExist())
    }

    @Test
    fun `a missed chore is listed for 30 days after its due date, a finished one stays`() {
        fixtures.createChore(janeId, name = "Missed 30", dueDate = today.minusDays(30))
        fixtures.createChore(janeId, name = "Missed 31", dueDate = today.minusDays(31))
        finished(janeId, "Done long ago", today.minusDays(90))
        assertThat(names("filter=closed")).containsExactly("Missed 30", "Done long ago")
    }

    @Test
    fun `closed leaves out removed chores and unfinished ones`() {
        fixtures.createChore(janeId, name = "Open")
        fixtures.createChore(janeId, name = "Late and gone", dueDate = today.minusDays(1), removed = true)
        assertThat(names("filter=closed")).isEmpty()
    }

    @Test
    fun `closed pages 50 at a time with an opaque cursor and no gaps or repeats`() {
        val ids = (0 until 55).map { finished(janeId, "Chore $it", today.minusDays((it % 7).toLong())) }
        val first = api.list("filter=closed").andExpect(status().isOk).json()
        val firstIds = JsonPath.read<List<Int>>(first, "$.items[*].choreId")
        val cursor = JsonPath.read<String>(first, "$.nextCursor")
        assertThat(firstIds).hasSize(50)
        assertThat(cursor).isNotBlank().doesNotContain("|")
        val second = api.list("filter=closed&cursor=$cursor").andExpect(status().isOk).json()
        val secondIds = JsonPath.read<List<Int>>(second, "$.items[*].choreId")
        assertThat(secondIds).hasSize(5)
        assertThat(JsonPath.read<Any?>(second, "$.nextCursor")).isNull()
        val all = firstIds + secondIds
        assertThat(all).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(ids.map { it.toInt() })
        val closedOn =
            JsonPath.read<List<String>>(first, "$.items[*].closedOn") + JsonPath.read<List<String>>(second, "$.items[*].closedOn")
        assertThat(closedOn).isSortedAccordingTo(Comparator.reverseOrder())
    }

    @Test
    fun `exactly 50 closed chores have no next cursor`() {
        repeat(50) { finished(janeId, "Chore $it", today.minusDays((it % 5).toLong())) }
        api.list("filter=closed").andExpect(jsonPath("$.items.length()").value(50)).andExpect(jsonPath("$.nextCursor").doesNotExist())
    }

    // ---- recent

    @Test
    fun `recent has one chore per distinct name, the latest, newest first, with icon and tasks`() {
        fixtures.createChore(janeId, name = "Tidy", iconKey = "broom", tasks = listOf("Old task" to "basket"), createdAt = at(1))
        fixtures.createChore(johnId, name = "Tidy", iconKey = "basket", tasks = listOf("New task" to "open-book"), createdAt = at(5))
        fixtures.createChore(janeId, name = "Dishes", createdAt = at(3))
        api.recent().andExpect(status().isOk)
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].name").value("Tidy"))
            .andExpect(jsonPath("$[0].iconKey").value("basket"))
            .andExpect(jsonPath("$[0].tasks.length()").value(1))
            .andExpect(jsonPath("$[0].tasks[0].label").value("New task"))
            .andExpect(jsonPath("$[0].tasks[0].iconKey").value("open-book"))
            .andExpect(jsonPath("$[1].name").value("Dishes"))
            .andExpect(jsonPath("$[1].tasks.length()").value(2))
    }

    @Test
    fun `recent is capped at 12 and includes removed and finished chores`() {
        repeat(13) { fixtures.createChore(janeId, name = "Chore $it", createdAt = at(1, it), removed = it == 12) }
        finished(janeId, "Finished one", today, createdAt = at(2))
        val names = api.recent().andExpect(status().isOk).read<List<String>>("$[*].name")
        assertThat(names).hasSize(12)
        assertThat(names.first()).isEqualTo("Finished one")
        assertThat(names[1]).isEqualTo("Chore 12")
        assertThat(names).doesNotContain("Chore 0", "Chore 1")
    }
}
