package com.stickerbank.family

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.http.ResponseCookie
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant

@WebMvcTest(FamilyController::class)
class FamilyControllerWebTest {
    @Autowired
    lateinit var mvc: MockMvc

    @MockkBean
    lateinit var reader: ParentSessionReader

    @MockkBean
    lateinit var bootstrapService: BootstrapService

    @MockkBean
    lateinit var pinService: PinService

    @MockkBean
    lateinit var sessionService: ParentSessionService

    @MockkBean
    lateinit var settingsService: FamilySettingsService

    private val unlockBody = """{"pin":"1234"}"""

    @Test
    fun `settings without a session is 401 PARENT_SESSION_REQUIRED`() {
        every { reader.hasValidSession(any()) } returns false
        mvc.perform(get("/api/parent/settings"))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("PARENT_SESSION_REQUIRED"))
    }

    @Test
    fun `changing the pin needs a session`() {
        every { reader.hasValidSession(any()) } returns false
        mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/parent/pin")
                .header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON)
                .content("""{"currentPin":"1234","newPin":"4321"}"""),
        ).andExpect(status().isUnauthorized)
    }

    @Test
    fun `unlock reaches the controller without a session and sets the cookie`() {
        every { reader.hasValidSession(any()) } returns false
        val now = Instant.parse("2026-10-15T15:00:00Z")
        every { pinService.unlock("1234") } returns
            StartedSession(
                ResponseCookie.from("sb_parent", "tok").httpOnly(true).build(),
                ParentSessionDto(300, now.plusSeconds(300), now.plusSeconds(999)),
            )
        mvc.perform(post("/api/parent/session").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(unlockBody))
            .andExpect(status().isOk)
            .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("sb_parent=tok")))
            .andExpect(jsonPath("$.idleTimeoutSeconds").value(300))
    }

    @Test
    fun `locked response carries retryAfterSeconds`() {
        every { reader.hasValidSession(any()) } returns false
        every { pinService.unlock(any()) } throws DomainException(ErrorCode.PIN_LOCKED, properties = mapOf("retryAfterSeconds" to 42L))
        mvc.perform(post("/api/parent/session").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(unlockBody))
            .andExpect(status().isTooManyRequests)
            .andExpect(jsonPath("$.code").value("PIN_LOCKED"))
            .andExpect(jsonPath("$.retryAfterSeconds").value(42))
    }

    @Test
    fun `incorrect response carries attemptsRemaining`() {
        every { reader.hasValidSession(any()) } returns false
        every { pinService.unlock(any()) } throws DomainException(ErrorCode.PIN_INCORRECT, properties = mapOf("attemptsRemaining" to 3))
        mvc.perform(post("/api/parent/session").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(unlockBody))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.attemptsRemaining").value(3))
    }

    @Test
    fun `post without the custom header is forbidden`() {
        every { reader.hasValidSession(any()) } returns false
        mvc.perform(post("/api/parent/session").contentType(MediaType.APPLICATION_JSON).content(unlockBody))
            .andExpect(status().isForbidden)
    }

    @Test
    fun `malformed pin is a validation failure`() {
        every { reader.hasValidSession(any()) } returns false
        mvc.perform(
            post("/api/parent/session").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content("""{"pin":"12"}"""),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("pin"))
    }
}
