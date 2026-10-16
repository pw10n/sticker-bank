package com.stickerbank.routine

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import io.mockk.verify
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@WebMvcTest(RoutineController::class)
class RoutineControllerWebMvcTest {
    @Autowired
    lateinit var mvc: MockMvc

    @MockkBean
    lateinit var service: RoutineService

    @MockkBean
    lateinit var sessions: ParentSessionReader

    @BeforeEach
    fun allowParentSession() {
        every { sessions.hasValidSession(any()) } returns true
    }

    private val body = """{"name":"Morning","iconKey":"crescent-moon","color":null,"days":null,"paused":false,"tasks":[]}"""
    private val day = LocalDate.of(2026, 10, 15)
    private val dto = RoutineDto(1, 2, 1, "Morning", "crescent-moon", null, emptyList(), false, day, emptyList(), emptyList())

    private fun createRequest() = post("/api/parent/children/2/routines")
        .header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body)

    @Test
    fun `create returns 201`() {
        every { service.create(2, any()) } returns RoutineSaveResultDto(dto, LocalDate.of(2026, 10, 15), false)
        mvc.perform(createRequest())
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.routine.id").value(1))
            .andExpect(jsonPath("$.appliesFromTomorrow").value(false))
    }

    @Test
    fun `validation failure is a 400 problem with field errors`() {
        every { service.create(2, any()) } throws
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto("days", "Pick a day"))))
        mvc.perform(createRequest())
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("days"))
    }

    @Test
    fun `missing routine is a 404 problem`() {
        every { service.get(9) } throws DomainException(ErrorCode.NOT_FOUND, "Routine not found")
        mvc.perform(get("/api/parent/routines/9"))
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
    }

    @Test
    fun `malformed body is a 400`() {
        mvc.perform(put("/api/parent/routines/1").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content("{"))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
    }

    @Test
    fun `skip is a 204 and bad date is a 400`() {
        every { service.skip(1, LocalDate.of(2026, 10, 16)) } returns Unit
        mvc.perform(put("/api/parent/routines/1/skips/2026-10-16").header("X-Sticker-Bank", "1")).andExpect(status().isNoContent)
        verify { service.skip(1, LocalDate.of(2026, 10, 16)) }
        mvc.perform(put("/api/parent/routines/1/skips/not-a-date").header("X-Sticker-Bank", "1")).andExpect(status().isBadRequest)
    }

    @Test
    fun `order is a 204`() {
        every { service.reorder(2, any()) } returns Unit
        mvc.perform(
            put("/api/parent/children/2/routines/order").header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content("""{"routineIds":[3,1,2]}"""),
        ).andExpect(status().isNoContent)
    }
}
