package com.stickerbank.chart

import com.stickerbank.common.Weekdays
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@IntegrationTest
class ChartIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var clock: MutableClock

    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(java.time.Instant.parse("2026-10-15T15:00:00Z"))
        childId = fixtures.createChild("Jane Doe")
    }

    private fun putTask(date: Any, taskId: Long, child: Long = childId, cookie: String? = null): ResultActions = mvc.perform(
        put("/api/children/$child/days/$date/tasks/$taskId").header("X-Sticker-Bank", "1").also {
            if (cookie != null) it.cookie(fixtures.parentCookie(cookie))
        },
    )

    private fun deleteTask(date: Any, taskId: Long, cookie: String? = null): ResultActions = mvc.perform(
        delete("/api/children/$childId/days/$date/tasks/$taskId").header("X-Sticker-Bank", "1").also {
            if (cookie != null) it.cookie(fixtures.parentCookie(cookie))
        },
    )

    private fun finish(date: Any, routineId: Long, cookie: String? = null, child: Long = childId): ResultActions = mvc.perform(
        post("/api/children/$child/days/$date/routines/$routineId/finish").header("X-Sticker-Bank", "1").also {
            if (cookie != null) it.cookie(fixtures.parentCookie(cookie))
        },
    )

    private fun parentCookie(): String {
        fixtures.setPin()
        return fixtures.createParentSession()
    }

    private fun stickerCount(routineId: Long) =
        jdbc.sql("SELECT COUNT(*) FROM sticker WHERE routine_id = ?").param(routineId).query(Long::class.java).single()

    @Test
    fun `chart lists routines in order with progress`() {
        val a = fixtures.createRoutine(childId, name = "Morning")
        fixtures.createRoutine(childId, name = "Evening")
        fixtures.completeTask(childId, a.routineId, a.taskIds[0], today)
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.isToday").value(true))
            .andExpect(jsonPath("$.routines[0].name").value("Morning"))
            .andExpect(jsonPath("$.routines[0].state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routines[0].doneCount").value(1))
            .andExpect(jsonPath("$.routines[0].taskCount").value(2))
            .andExpect(jsonPath("$.routines[1].name").value("Evening"))
            .andExpect(jsonPath("$.routines[1].state").value("NOT_STARTED"))
    }

    @Test
    fun `weekday routine is absent on saturday`() {
        fixtures.createRoutine(childId, daysMask = Weekdays.ALL and 0b0011111)
        mvc.perform(get("/api/children/$childId/days/2026-10-17"))
            .andExpect(status().isUnprocessableEntity)
        clock.set(java.time.Instant.parse("2026-10-17T15:00:00Z"))
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.routines.length()").value(0))
    }

    @Test
    fun `mark done then undo`() {
        val r = fixtures.createRoutine(childId)
        putTask("today", r.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        deleteTask("today", r.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("NOT_STARTED"))
            .andExpect(jsonPath("$.routine.doneCount").value(0))
    }

    @Test
    fun `the last task only makes the routine ready to finish and earns nothing`() {
        val r = fixtures.createRoutine(childId)
        putTask(today, r.taskIds[0]).andExpect(status().isOk)
        putTask(today, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.routine.doneCount").value(2))
            .andExpect(jsonPath("$.routine.sticker").doesNotExist())
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(stickerCount(r.routineId)).isZero()
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
    }

    @Test
    fun `a task tapped by mistake is undone with a plain delete while the routine is ready to finish`() {
        val r = fixtures.createRoutine(childId)
        putTask(today, r.taskIds[0]).andExpect(status().isOk)
        putTask(today, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))

        // FR-6.7: no confirmation, no revoke, not even a parent session
        deleteTask(today, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routine.doneCount").value(1))
            .andExpect(jsonPath("$.revoked").doesNotExist())
        // and finishing is refused until every task is done again
        finish(today, r.routineId).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_NOT_READY"))
        assertThat(stickerCount(r.routineId)).isZero()

        putTask(today, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
    }

    @Test
    fun `finishing earns exactly one sticker and locks the routine`() {
        val r = fixtures.createRoutine(childId)
        putTask(today, r.taskIds[0]).andExpect(status().isOk)
        putTask(today, r.taskIds[1]).andExpect(status().isOk)
        val first = finish(today, r.routineId).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.pick.choices.length()").value(3))
            .andExpect(jsonPath("$.pick.autoAwarded").value(false))
            .andReturn().response.contentAsString
        assertThat(stickerCount(r.routineId)).isEqualTo(1)
        assertThat(jdbc.sql("SELECT finish_mode FROM sticker WHERE routine_id = ?").param(r.routineId).query(String::class.java).single())
            .isEqualTo("TAPPED")

        // a second tap (or a second device) gets the same saved choices, never a second sticker (BR-6, BR-7)
        val second = finish(today, r.routineId).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
            .andReturn().response.contentAsString
        assertThat(com.jayway.jsonpath.JsonPath.read<List<Int>>(second, "$.pick.choices[*].designId"))
            .isEqualTo(com.jayway.jsonpath.JsonPath.read<List<Int>>(first, "$.pick.choices[*].designId"))
        assertThat(stickerCount(r.routineId)).isEqualTo(1)

        putTask(today, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(stickerCount(r.routineId)).isEqualTo(1)
        deleteTask(today, r.taskIds[1]).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
    }

    @Test
    fun `finishing before every task is done is refused and earns nothing`() {
        val r = fixtures.createRoutine(childId)
        putTask(today, r.taskIds[0]).andExpect(status().isOk)
        finish(today, r.routineId).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_NOT_READY"))
        assertThat(stickerCount(r.routineId)).isZero()
    }

    @Test
    fun `finish without the CSRF header is refused and earns nothing`() {
        val r = fixtures.createRoutine(childId)
        r.taskIds.forEach { fixtures.completeTask(childId, r.routineId, it, today) }
        // a cross-site form post cannot add the custom header, so this is the whole CSRF defense (TDD 11.2)
        mvc.perform(post("/api/children/$childId/days/$today/routines/${r.routineId}/finish"))
            .andExpect(status().isForbidden)
            .andExpect(jsonPath("$.code").value("CSRF_HEADER_MISSING"))
        mvc.perform(post("/api/children/$childId/days/$today/routines/${r.routineId}/finish").header("X-Sticker-Bank", "0"))
            .andExpect(status().isForbidden)
        assertThat(stickerCount(r.routineId)).isZero()
        // the same request with the header works
        finish(today, r.routineId).andExpect(status().isOk)
        assertThat(stickerCount(r.routineId)).isEqualTo(1)
    }

    @Test
    fun `finish rejects the wrong day, a skipped routine and another child's routine`() {
        val r = fixtures.createRoutine(childId)
        r.taskIds.forEach { fixtures.completeTask(childId, r.routineId, it, today) }
        finish(yesterday, r.routineId).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DAY_CHANGED")).andExpect(jsonPath("$.today").value("2026-10-15"))
        finish(today.plusDays(1), r.routineId).andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.code").value("FUTURE_DATE"))
        val other = fixtures.createChild("John Doe")
        finish(today, r.routineId, child = other).andExpect(status().isNotFound)
        jdbc.sql("INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, NOW())").params(r.routineId, today).update()
        finish(today, r.routineId).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_NOT_SCHEDULED"))
        assertThat(stickerCount(r.routineId)).isZero()
    }

    @Test
    fun `child cannot write yesterday`() {
        val r = fixtures.createRoutine(childId)
        putTask(yesterday, r.taskIds[0]).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DAY_CHANGED"))
            .andExpect(jsonPath("$.today").value("2026-10-15"))
    }

    @Test
    fun `parent completes yesterday and the sticker is unclaimed today`() {
        val r = fixtures.createRoutine(childId)
        val cookie = parentCookie()
        putTask(yesterday, r.taskIds[0], cookie = cookie).andExpect(status().isOk)
        putTask(yesterday, r.taskIds[1], cookie = cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
        finish(yesterday, r.routineId, cookie = cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(1))
            .andExpect(jsonPath("$.unclaimedFromEarlierDays[0].chartDate").value("2026-10-14"))
    }

    @Test
    fun `future date is rejected`() {
        val r = fixtures.createRoutine(childId)
        putTask(today.plusDays(1), r.taskIds[0]).andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.code").value("FUTURE_DATE"))
    }

    @Test
    fun `skipped routine cannot be toggled`() {
        val r = fixtures.createRoutine(childId)
        jdbc.sql("INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, NOW())").params(r.routineId, today).update()
        putTask(today, r.taskIds[0]).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_NOT_SCHEDULED"))
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("SKIPPED"))
    }

    @Test
    fun `task of another child is not found`() {
        val other = fixtures.createChild("John Doe")
        val r = fixtures.createRoutine(other)
        putTask(today, r.taskIds[0]).andExpect(status().isNotFound)
    }

    @Test
    fun `empty pool falls back to an auto awarded sticker`() {
        val r = fixtures.createRoutine(childId)
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE is_fallback = FALSE").update()
        putTask(today, r.taskIds[0]).andExpect(status().isOk)
        putTask(today, r.taskIds[1]).andExpect(status().isOk)
        finish(today, r.routineId).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("EARNED"))
            .andExpect(jsonPath("$.pick.autoAwarded").value(true))
    }

    @Test
    fun `past day with partial progress is missed`() {
        val r = fixtures.createRoutine(childId)
        fixtures.completeTask(childId, r.routineId, r.taskIds[0], yesterday)
        mvc.perform(get("/api/children/$childId/days/$yesterday"))
            .andExpect(jsonPath("$.isToday").value(false))
            .andExpect(jsonPath("$.routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.routines[0].doneCount").value(1))
    }

    @Test
    fun `history covers every day with states`() {
        val r = fixtures.createRoutine(childId)
        val design = fixtures.activeDesignIds().first()
        fixtures.completeTask(childId, r.routineId, r.taskIds[0], today.minusDays(3))
        fixtures.completeTask(childId, r.routineId, r.taskIds[1], today.minusDays(3))
        fixtures.createSticker(childId, r.routineId, today.minusDays(3), com.stickerbank.common.StickerStatus.AVAILABLE, design)
        jdbc.sql(
            "INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, NOW())",
        ).params(r.routineId, today.minusDays(2)).update()
        val cookie = parentCookie()
        mvc.perform(
            get("/api/parent/children/$childId/history?from=${today.minusDays(6)}&to=$today").cookie(fixtures.parentCookie(cookie)),
        ).andExpect(status().isOk)
            .andExpect(jsonPath("$.days.length()").value(7))
            .andExpect(jsonPath("$.days[3].routines[0].state").value("EARNED"))
            .andExpect(jsonPath("$.days[4].routines[0].state").value("SKIPPED"))
            .andExpect(jsonPath("$.days[5].routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.days[6].routines[0].state").value("NOT_STARTED"))
    }

    @Test
    fun `history range over 62 days is rejected`() {
        val cookie = parentCookie()
        mvc.perform(
            get("/api/parent/children/$childId/history?from=${today.minusDays(62)}&to=$today").cookie(fixtures.parentCookie(cookie)),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
    }

    @Test
    fun `two devices checking the last tasks leave the routine ready to finish without a sticker`() {
        val r = fixtures.createRoutine(childId)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        val statuses =
            r.taskIds.map { id ->
                pool.submit<Int> {
                    start.await()
                    putTask(today, id).andReturn().response.status
                }
            }
        start.countDown()
        val results = statuses.map { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()
        assertThat(results).containsOnly(200)
        assertThat(stickerCount(r.routineId)).isZero()
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
    }

    @Test
    fun `two devices tapping I'm Done! at once produce one sticker and the same choices`() {
        val r = fixtures.createRoutine(childId)
        r.taskIds.forEach { fixtures.completeTask(childId, r.routineId, it, today) }
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        val bodies =
            (1..2).map {
                pool.submit<Pair<Int, String>> {
                    start.await()
                    val response = finish(today, r.routineId).andReturn().response
                    response.status to response.contentAsString
                }
            }
        start.countDown()
        val results = bodies.map { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()
        assertThat(results.map { it.first }).containsOnly(200)
        assertThat(stickerCount(r.routineId)).isEqualTo(1)
        val choices = results.map { com.jayway.jsonpath.JsonPath.read<List<Int>>(it.second, "$.pick.choices[*].designId") }
        assertThat(choices[0]).hasSize(3).isEqualTo(choices[1])
    }
}
