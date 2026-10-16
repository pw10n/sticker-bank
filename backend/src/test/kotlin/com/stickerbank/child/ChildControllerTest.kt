package com.stickerbank.child

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import io.mockk.just
import io.mockk.runs
import io.mockk.verify
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant

@WebMvcTest(ChildController::class)
class ChildControllerTest {
    @Autowired
    lateinit var mvc: MockMvc

    @MockkBean
    lateinit var service: ChildService

    @MockkBean
    lateinit var sessions: ParentSessionReader

    @BeforeEach
    fun setUp() {
        every { sessions.hasValidSession(any()) } returns true
    }

    @Test
    fun `invalid body is a validation failure`() {
        mvc.perform(
            post("/api/parent/children").header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content("""{"name":"","avatarKey":"cat-face","themeColor":"#FFB703"}"""),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
    }

    @Test
    fun `valid create returns 201`() {
        every { service.create(any()) } returns ChildDto(1, "Jane Doe", "cat-face", "#FFB703", 1, Instant.parse("2026-10-15T15:00:00Z"))
        mvc.perform(
            post("/api/parent/children").header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content("""{"name":"Jane Doe","avatarKey":"cat-face","themeColor":"#FFB703"}"""),
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.name").value("Jane Doe"))
    }

    @Test
    fun `delete returns 204`() {
        every { service.delete(5) } just runs
        mvc.perform(delete("/api/parent/children/5").header("X-Sticker-Bank", "1")).andExpect(status().isNoContent)
        verify { service.delete(5) }
    }

    @Test
    fun `unknown id is a 404 problem`() {
        every { service.delete(99) } throws DomainException(ErrorCode.NOT_FOUND, "Child not found")
        mvc.perform(delete("/api/parent/children/99").header("X-Sticker-Bank", "1"))
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("NOT_FOUND"))
    }

    private fun createWithName(name: String) = mvc.perform(
        post("/api/parent/children").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON)
            .content("""{"name":"$name","avatarKey":"cat-face","themeColor":"#FFB703"}"""),
    )

    private fun stubNormalizingCreate() {
        every { service.create(any()) } answers {
            val name = ChildNameRules.normalize(firstArg<ChildInput>().name)
            ChildDto(1, name, "cat-face", "#FFB703", 1, Instant.parse("2026-10-15T15:00:00Z"))
        }
    }

    @Test
    fun `forty chars surrounded by spaces are accepted and stored trimmed`() {
        stubNormalizingCreate()
        val name = "a".repeat(40)
        createWithName("  $name  ").andExpect(status().isCreated).andExpect(jsonPath("$.name").value(name))
    }

    @Test
    fun `forty emoji are accepted`() {
        stubNormalizingCreate()
        createWithName("\uD83D\uDE00".repeat(40)).andExpect(status().isCreated)
    }

    @Test
    fun `forty one code points are a validation failure on name`() {
        stubNormalizingCreate()
        createWithName("a".repeat(41))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
    }
}
