package com.stickerbank.chart

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.Actor
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@WebMvcTest(ChartController::class)
class ChartControllerWebTest {
    @Autowired lateinit var mvc: MockMvc

    @MockkBean lateinit var charts: ChartService

    @MockkBean lateinit var completions: CompletionService

    @MockkBean lateinit var historyService: HistoryService

    @MockkBean lateinit var sessions: ParentSessionReader

    private val path = "/api/children/1/days/2026-10-14/tasks/5"

    @Test
    fun `child put for yesterday is day changed`() {
        every { sessions.hasValidSession(any()) } returns false
        every { completions.complete(1, "2026-10-14", 5, Actor.CHILD) } throws
            DomainException(ErrorCode.DAY_CHANGED, properties = mapOf("today" to "2026-10-15"))
        mvc.perform(put(path).header("X-Sticker-Bank", "1"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DAY_CHANGED"))
            .andExpect(jsonPath("$.today").value("2026-10-15"))
    }

    @Test
    fun `future put is 422`() {
        every { sessions.hasValidSession(any()) } returns false
        every { completions.complete(1, "2026-10-16", 5, Actor.CHILD) } throws DomainException(ErrorCode.FUTURE_DATE)
        mvc.perform(put("/api/children/1/days/2026-10-16/tasks/5").header("X-Sticker-Bank", "1"))
            .andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.code").value("FUTURE_DATE"))
    }

    @Test
    fun `delete locked is 409`() {
        every { sessions.hasValidSession(any()) } returns true
        every { completions.undo(1, "2026-10-14", 5, Actor.PARENT) } throws DomainException(ErrorCode.ROUTINE_LOCKED)
        mvc.perform(delete(path).header("X-Sticker-Bank", "1"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
    }

    @Test
    fun `history without session is 401`() {
        every { sessions.hasValidSession(any()) } returns false
        mvc.perform(get("/api/parent/children/1/history?from=2026-10-09&to=2026-10-15"))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("PARENT_SESSION_REQUIRED"))
    }

    @Test
    fun `history bad date is 400`() {
        every { sessions.hasValidSession(any()) } returns true
        every { historyService.history(1, "bad", "2026-10-15") } throws
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto("from", "bad"))))
        mvc.perform(get("/api/parent/children/1/history?from=bad&to=2026-10-15"))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("from"))
    }

    @Test
    fun `chart bad date is 400`() {
        every { sessions.hasValidSession(any()) } returns false
        every { charts.dailyChart(1, "nope") } throws
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto("date", "bad"))))
        mvc.perform(get("/api/children/1/days/nope")).andExpect(status().isBadRequest)
    }

    @Test
    fun `chart returns json`() {
        every { sessions.hasValidSession(any()) } returns false
        every { charts.dailyChart(1, "today") } returns DailyChartDto(1, LocalDate.of(2026, 10, 15), true, emptyList(), emptyList())
        mvc.perform(get("/api/children/1/days/today"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.isToday").value(true))
    }
}
