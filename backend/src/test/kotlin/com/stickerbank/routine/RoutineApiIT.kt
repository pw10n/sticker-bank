package com.stickerbank.routine

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Instant
import java.time.LocalDate

@IntegrationTest
class RoutineApiIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var plans: RoutinePlanQuery

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var mapper: JsonMapper

    @Autowired lateinit var clock: MutableClock

    private val today = LocalDate.of(2026, 10, 15)
    private val tomorrow = today.plusDays(1)
    private lateinit var cookie: Cookie
    private var childId = 0L

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        fixtures.setPin()
        cookie = fixtures.parentCookie(fixtures.createParentSession())
        childId = fixtures.createChild()
    }

    private fun write(builder: MockHttpServletRequestBuilder, body: Any? = null): MockHttpServletRequestBuilder {
        builder.cookie(cookie).header("X-Sticker-Bank", "1")
        if (body !=
            null
        ) {
            builder.contentType(MediaType.APPLICATION_JSON).content(if (body is String) body else mapper.writeValueAsString(body))
        }
        return builder
    }

    private fun json(result: MvcResult): JsonNode = mapper.readTree(result.response.contentAsString)

    private fun task(label: String, id: Long? = null, icon: String = "bathtub") = mapOf("id" to id, "label" to label, "iconKey" to icon)

    private fun input(
        name: String = "Morning",
        days: List<String>? = null,
        paused: Boolean = false,
        tasks: List<Map<String, Any?>> = listOf(task("Brush teeth"), task("Get dressed")),
    ) = mapOf("name" to name, "iconKey" to "crescent-moon", "color" to null, "days" to days, "paused" to paused, "tasks" to tasks)

    private fun createRoutine(body: Map<String, Any?> = input(), forChild: Long = childId): JsonNode {
        val result = mvc.perform(write(post("/api/parent/children/$forChild/routines"), body)).andExpect(status().isCreated).andReturn()
        return json(result).get("routine")
    }

    private fun edit(routineId: Long, body: Map<String, Any?>): JsonNode =
        json(mvc.perform(write(put("/api/parent/routines/$routineId"), body)).andExpect(status().isOk).andReturn())

    private fun revisionCount(routineId: Long) =
        jdbc.sql("SELECT COUNT(*) FROM routine_revision WHERE routine_id = ?").param(routineId).query(Long::class.java).single()

    private fun taskIds(routine: JsonNode): List<Long> = routine.get("tasks").values().map { it.get("id").asLong() }

    @Test
    fun `created routine is on today's plan with all seven days`() {
        val routine = createRoutine()
        assertThat(routine.get("days").size()).isEqualTo(7)
        val plan = plans.planFor(childId, today)
        assertThat(plan.map { it.routineId }).containsExactly(routine.get("id").asLong())
        assertThat(plan.single().tasks).hasSize(2)
    }

    @Test
    fun `weekday routine is not on saturday`() {
        val routine = createRoutine(input(days = listOf("MON", "TUE", "WED", "THU", "FRI")))
        val id = routine.get("id").asLong()
        assertThat(plans.plannedRoutine(id, today)).isNotNull()
        assertThat(plans.plannedRoutine(id, LocalDate.of(2026, 10, 17))).isNull()
    }

    @Test
    fun `create rejects task ids and empty days`() {
        mvc.perform(write(post("/api/parent/children/$childId/routines"), input(tasks = listOf(task("A", id = 5)))))
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("tasks[0].id"))
        mvc.perform(write(post("/api/parent/children/$childId/routines"), input(days = emptyList())))
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `edit before any sticker applies today`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        val result = edit(id, input(name = "Renamed", tasks = listOf(task("Only", id = taskIds(routine)[0]))))
        assertThat(result.get("appliesFromTomorrow").asBoolean()).isFalse()
        assertThat(result.get("effectiveFrom").asString()).isEqualTo(today.toString())
        assertThat(plans.plannedRoutine(id, today)?.name).isEqualTo("Renamed")
    }

    @Test
    fun `edit after earning today takes effect tomorrow`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        fixtures.createSticker(childId, id, today, StickerStatus.UNCLAIMED, null)
        val result = edit(id, input(name = "Renamed", tasks = listOf(task("New task"))))
        assertThat(result.get("effectiveFrom").asString()).isEqualTo(tomorrow.toString())
        assertThat(result.get("appliesFromTomorrow").asBoolean()).isTrue()
        assertThat(plans.plannedRoutine(id, today)?.name).isEqualTo("Morning")
        assertThat(plans.plannedRoutine(id, tomorrow)?.name).isEqualTo("Renamed")
    }

    @Test
    fun `past days keep their routine and tasks after edits`() {
        val old = fixtures.createRoutine(childId, name = "Old", effectiveFrom = today.minusDays(10))
        val yesterday = today.minusDays(1)
        val before = plans.planFor(childId, yesterday)
        edit(old.routineId, input(name = "New", tasks = listOf(task("Different"))))
        assertThat(plans.planFor(childId, yesterday)).isEqualTo(before)
        assertThat(plans.planFor(childId, today).single().name).isEqualTo("New")
    }

    @Test
    fun `two edits on one day share one revision row`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        edit(id, input(name = "First", tasks = listOf(task("A"))))
        edit(id, input(name = "Second", tasks = listOf(task("B"))))
        assertThat(revisionCount(id)).isEqualTo(1L)
        assertThat(plans.plannedRoutine(id, today)?.name).isEqualTo("Second")
    }

    @Test
    fun `delete removes the routine today when nothing was earned`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        mvc.perform(write(delete("/api/parent/routines/$id")))
            .andExpect(status().isOk).andExpect(jsonPath("$.effectiveFrom").value(today.toString()))
        mvc.perform(get("/api/parent/children/$childId/routines").cookie(cookie)).andExpect(jsonPath("$.length()").value(0))
        mvc.perform(get("/api/parent/routines/$id").cookie(cookie)).andExpect(status().isNotFound)
        assertThat(plans.planFor(childId, today)).isEmpty()
    }

    @Test
    fun `delete after earning keeps today and the sticker, removes tomorrow`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        fixtures.createSticker(childId, id, today, StickerStatus.UNCLAIMED, null)
        mvc.perform(write(delete("/api/parent/routines/$id")))
            .andExpect(status().isOk).andExpect(jsonPath("$.effectiveFrom").value(tomorrow.toString()))
        assertThat(plans.planFor(childId, today).map { it.routineId }).containsExactly(id)
        assertThat(plans.planFor(childId, tomorrow)).isEmpty()
        val stickers = jdbc.sql("SELECT COUNT(*) FROM sticker WHERE routine_id = ?").param(id).query(Long::class.java).single()
        assertThat(stickers).isEqualTo(1L)
    }

    @Test
    fun `paused and taskless routines are not on the chart`() {
        createRoutine(input(name = "Paused", paused = true))
        createRoutine(input(name = "Empty", tasks = emptyList()))
        assertThat(plans.planFor(childId, today)).isEmpty()
    }

    @Test
    fun `reorder rewrites positions and rejects a wrong set`() {
        val a = createRoutine(input(name = "A")).get("id").asLong()
        val b = createRoutine(input(name = "B")).get("id").asLong()
        mvc.perform(write(put("/api/parent/children/$childId/routines/order"), mapOf("routineIds" to listOf(b, a))))
            .andExpect(status().isNoContent)
        assertThat(plans.planFor(childId, today).map { it.routineId }).containsExactly(b, a)
        mvc.perform(write(put("/api/parent/children/$childId/routines/order"), mapOf("routineIds" to listOf(b))))
            .andExpect(status().isBadRequest)
        mvc.perform(write(put("/api/parent/children/$childId/routines/order"), mapOf("routineIds" to listOf(b, b))))
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `copy creates independent routine with new task ids`() {
        val source = createRoutine()
        val other = fixtures.createChild("Test User")
        val copy =
            json(
                mvc.perform(write(post("/api/parent/routines/${source.get("id").asLong()}/copy"), mapOf("targetChildId" to other)))
                    .andExpect(status().isCreated).andReturn(),
            )
        assertThat(copy.get("childId").asLong()).isEqualTo(other)
        assertThat(copy.get("id").asLong()).isNotEqualTo(source.get("id").asLong())
        assertThat(taskIds(copy).intersect(taskIds(source).toSet())).isEmpty()
        edit(copy.get("id").asLong(), input(name = "Copy renamed"))
        assertThat(plans.planFor(childId, today).single().name).isEqualTo("Morning")
    }

    @Test
    fun `skip flags the plan, conflicts with a sticker, and can be undone`() {
        val id = createRoutine().get("id").asLong()
        mvc.perform(write(put("/api/parent/routines/$id/skips/$tomorrow"))).andExpect(status().isNoContent)
        mvc.perform(write(put("/api/parent/routines/$id/skips/$tomorrow"))).andExpect(status().isNoContent)
        assertThat(plans.planFor(childId, tomorrow).single().skipped).isTrue()
        mvc.perform(get("/api/parent/routines/$id").cookie(cookie)).andExpect(jsonPath("$.upcomingSkips[0]").value(tomorrow.toString()))
        mvc.perform(write(delete("/api/parent/routines/$id/skips/$tomorrow"))).andExpect(status().isNoContent)
        assertThat(plans.planFor(childId, tomorrow).single().skipped).isFalse()
        fixtures.createSticker(childId, id, today, StickerStatus.UNCLAIMED, null)
        mvc.perform(write(put("/api/parent/routines/$id/skips/$today")))
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
    }

    @Test
    fun `foreign task id is rejected`() {
        val mine = createRoutine()
        val theirs = createRoutine(input(name = "Other"))
        mvc.perform(
            write(put("/api/parent/routines/${mine.get("id").asLong()}"), input(tasks = listOf(task("X", id = taskIds(theirs)[0])))),
        )
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("tasks[0].id"))
    }

    @Test
    fun `task removed then re-added the same day keeps its completion`() {
        val routine = createRoutine()
        val id = routine.get("id").asLong()
        val (first, second) = taskIds(routine)
        fixtures.completeTask(childId, id, first, today)
        edit(id, input(tasks = listOf(task("Get dressed", id = second))))
        edit(id, input(tasks = listOf(task("Brush teeth", id = first), task("Get dressed", id = second))))
        val done = jdbc.sql("SELECT COUNT(*) FROM task_completion WHERE task_id = ?").param(first).query(Long::class.java).single()
        assertThat(done).isEqualTo(1L)
        assertThat(plans.plannedRoutine(id, today)?.tasks?.map { it.taskId }).containsExactly(first, second)
    }

    @Test
    fun `range plan matches per-day plan over 14 days`() {
        val a = createRoutine(input(name = "A", days = listOf("MON", "WED")))
        createRoutine(input(name = "B"))
        edit(a.get("id").asLong(), input(name = "A2", days = listOf("TUE", "THU")))
        mvc.perform(write(put("/api/parent/routines/${a.get("id").asLong()}/skips/${today.plusDays(3)}"))).andExpect(status().isNoContent)
        val from = today.minusDays(6)
        val to = today.plusDays(7)
        val range = plans.planForRange(childId, from, to)
        assertThat(range).hasSize(14)
        generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(to) }.forEach { day ->
            assertThat(range.getValue(day)).describedAs(day.toString()).isEqualTo(plans.planFor(childId, day))
        }
    }
}
