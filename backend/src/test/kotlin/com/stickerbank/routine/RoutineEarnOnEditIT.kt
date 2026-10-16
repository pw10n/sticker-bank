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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

/** I-3: removing the last unfinished task earns the sticker right away. */
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

    @Test
    fun `removing the unfinished task earns the sticker and returns the pick`() {
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
            .andExpect(jsonPath("$.earnedPick.stickerId").isNumber)
            .andExpect(jsonPath("$.earnedPick.choices").isNotEmpty)
            .andExpect(jsonPath("$.appliesFromTomorrow").value(false))

        val rows = jdbc.sql("SELECT COUNT(*) FROM sticker WHERE routine_id = ? AND chart_date = ?")
            .param(routine.routineId).param(today).query(Long::class.java).single()
        assertThat(rows).isEqualTo(1L)
    }
}
