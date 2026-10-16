package com.stickerbank.routine

import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

/** I-3 / BR-18: removing the last unfinished task only makes the routine Ready to finish. Saving never earns. */
@IntegrationTest
class RoutineEarnOnEditIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var clock: MutableClock

    private val today = LocalDate.of(2026, 10, 15)

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        fixtures.setPin()
    }

    private fun stickerRows(routineId: Long) = jdbc.sql("SELECT COUNT(*) FROM sticker WHERE routine_id = ? AND chart_date = ?")
        .param(routineId).param(today).query(Long::class.java).single()

    @Test
    fun `removing the unfinished task makes the routine ready to finish and earns nothing`() {
        val cookie = fixtures.parentCookie(fixtures.createParentSession())
        val childId = fixtures.createChild()
        val routine = fixtures.createRoutine(childId, tasks = listOf("Brush teeth" to "bathtub", "Get dressed" to "bathtub"))
        fixtures.completeTask(childId, routine.routineId, routine.taskIds[0], today)

        val body =
            """{"name":"Morning Routine","iconKey":"crescent-moon","color":null,"days":null,"paused":false,
               "tasks":[{"id":${routine.taskIds[0]},"label":"Brush teeth","iconKey":"bathtub"}]}"""
        mvc.perform(
            put("/api/parent/routines/${routine.routineId}").cookie(cookie).header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content(body),
        ).andExpect(status().isOk)
            .andExpect(jsonPath("$.earnedPick").doesNotExist())
            .andExpect(jsonPath("$.appliesFromTomorrow").value(false))

        assertThat(stickerRows(routine.routineId)).isZero()
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.routines[0].taskCount").value(1))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
    }

    @Test
    fun `adding a task to a routine that is ready to finish puts it back in progress`() {
        val cookie = fixtures.parentCookie(fixtures.createParentSession())
        val childId = fixtures.createChild()
        val routine = fixtures.createRoutine(childId, tasks = listOf("Brush teeth" to "bathtub"))
        fixtures.completeTask(childId, routine.routineId, routine.taskIds[0], today)
        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))

        val body =
            """{"name":"Morning Routine","iconKey":"crescent-moon","color":null,"days":null,"paused":false,
               "tasks":[{"id":${routine.taskIds[0]},"label":"Brush teeth","iconKey":"bathtub"},
                        {"label":"Get dressed","iconKey":"bathtub"}]}"""
        mvc.perform(
            put("/api/parent/routines/${routine.routineId}").cookie(cookie).header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content(body),
        ).andExpect(status().isOk).andExpect(jsonPath("$.appliesFromTomorrow").value(false))

        mvc.perform(get("/api/children/$childId/days/today"))
            .andExpect(jsonPath("$.routines[0].state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routines[0].doneCount").value(1))
            .andExpect(jsonPath("$.routines[0].taskCount").value(2))
        assertThat(stickerRows(routine.routineId)).isZero()
    }
}
