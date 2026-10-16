package com.stickerbank.family

import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Duration

@IntegrationTest
class FamilyIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: MutableClock

    @Autowired lateinit var jdbc: JdbcClient

    @BeforeEach
    fun reset() {
        dbCleaner.reset()
    }

    private fun json(
        builder: org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder,
        body: String,
        cookie: Cookie? = null,
    ) = mvc.perform(
        builder.header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body).also {
            if (cookie !=
                null
            ) {
                it.cookie(cookie)
            }
        },
    )

    private fun setup(pin: String = "1234", tz: String = "UTC"): ResultActions =
        json(post("/api/parent/pin"), """{"pin":"$pin","timeZone":"$tz"}""")

    private fun unlock(pin: String): ResultActions = json(post("/api/parent/session"), """{"pin":"$pin"}""")

    private fun cookieOf(result: ResultActions): Cookie = requireNotNull(result.andReturn().response.getCookie("sb_parent"))

    private fun sessionStatus(cookie: Cookie) = mvc.perform(get("/api/parent/session").cookie(cookie))

    @Test
    fun `setup sets the cookie and clears setupRequired`() {
        mvc.perform(get("/api/bootstrap")).andExpect(jsonPath("$.setupRequired").value(true))
        val result = setup().andExpect(status().isCreated)
            .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("HttpOnly")))
        assertThat(cookieOf(result).value).isNotBlank()
        mvc.perform(get("/api/bootstrap")).andExpect(jsonPath("$.setupRequired").value(false))
    }

    @Test
    fun `setup twice is a conflict`() {
        setup().andExpect(status().isCreated)
        setup().andExpect(status().isConflict).andExpect(jsonPath("$.code").value("PIN_ALREADY_SET"))
    }

    @Test
    fun `invalid time zone is rejected`() {
        setup(tz = "Mars/Base").andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("timeZone"))
    }

    @Test
    fun `unlock before setup is a conflict`() {
        unlock("1234").andExpect(status().isConflict).andExpect(jsonPath("$.code").value("PIN_NOT_SET"))
    }

    @Test
    fun `five wrong pins lock and the cooldown expires`() {
        fixtures.setPin("1234")
        listOf(4, 3, 2, 1).forEach {
            unlock("0000").andExpect(status().isUnauthorized).andExpect(jsonPath("$.attemptsRemaining").value(it))
        }
        unlock("0000").andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.attemptsRemaining").value(0))
            .andExpect(jsonPath("$.retryAfterSeconds").value(60))
        unlock("1234").andExpect(status().isTooManyRequests).andExpect(jsonPath("$.code").value("PIN_LOCKED"))
        clock.advance(Duration.ofSeconds(61))
        unlock("1234").andExpect(status().isOk)
    }

    @Test
    fun `second lockout lasts five minutes`() {
        fixtures.setPin("1234")
        repeat(5) { unlock("0000") }
        clock.advance(Duration.ofSeconds(61))
        repeat(4) { unlock("0000").andExpect(status().isUnauthorized) }
        unlock("0000").andExpect(jsonPath("$.retryAfterSeconds").value(300))
    }

    @Test
    fun `idle expiry and touch`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234").andExpect(status().isOk))
        clock.advance(Duration.ofSeconds(200))
        mvc.perform(post("/api/parent/session/touch").header("X-Sticker-Bank", "1").cookie(cookie)).andExpect(status().isOk)
        clock.advance(Duration.ofSeconds(200))
        sessionStatus(cookie).andExpect(status().isOk)
        clock.advance(Duration.ofSeconds(301))
        sessionStatus(cookie).andExpect(status().isUnauthorized).andExpect(jsonPath("$.code").value("PARENT_SESSION_REQUIRED"))
    }

    @Test
    fun `absolute expiry applies even when active`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234"))
        // Stay active (well inside the 300 s idle timeout) for just under 12 h, then cross the absolute limit.
        repeat(179) {
            clock.advance(Duration.ofSeconds(240))
            sessionStatus(cookie).andExpect(status().isOk)
        }
        sessionStatus(cookie).andExpect(status().isOk)
        clock.advance(Duration.ofSeconds(240))
        sessionStatus(cookie).andExpect(status().isUnauthorized)
    }

    @Test
    fun `lock deletes the session`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234"))
        mvc.perform(delete("/api/parent/session").header("X-Sticker-Bank", "1").cookie(cookie)).andExpect(status().isNoContent)
        sessionStatus(cookie).andExpect(status().isUnauthorized)
    }

    @Test
    fun `changing pin with a wrong current pin counts toward lockout`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234"))
        json(put("/api/parent/pin"), """{"currentPin":"9999","newPin":"4321"}""", cookie)
            .andExpect(status().isUnauthorized).andExpect(jsonPath("$.attemptsRemaining").value(4))
    }

    @Test
    fun `changing pin keeps this session and kills others`() {
        fixtures.setPin("1234")
        val mine = cookieOf(unlock("1234"))
        val other = cookieOf(unlock("1234"))
        json(put("/api/parent/pin"), """{"currentPin":"1234","newPin":"4321"}""", mine).andExpect(status().isNoContent)
        sessionStatus(mine).andExpect(status().isOk)
        sessionStatus(other).andExpect(status().isUnauthorized)
        unlock("1234").andExpect(status().isUnauthorized)
        unlock("4321").andExpect(status().isOk)
    }

    @Test
    fun `admin reset clears pin and sessions and is logged`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234"))
        jdbc.sql("CALL reset_parent_pin('Test Admin')").update()
        mvc.perform(get("/api/bootstrap")).andExpect(jsonPath("$.setupRequired").value(true))
        sessionStatus(cookie).andExpect(status().isUnauthorized)
        val fresh = cookieOf(setup("5678").andExpect(status().isCreated))
        mvc.perform(get("/api/parent/settings").cookie(fresh))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.lastPinReset.adminName").value("Test Admin"))
    }

    @Test
    fun `blank admin name is rejected by the procedure`() {
        assertThatThrownBy { jdbc.sql("CALL reset_parent_pin('  ')").update() }.isInstanceOf(Exception::class.java)
    }

    @Test
    fun `settings update changes the time zone and idle timeout`() {
        fixtures.setPin("1234")
        val cookie = cookieOf(unlock("1234"))
        json(put("/api/parent/settings"), """{"timeZone":"America/Los_Angeles","parentIdleTimeoutSeconds":600}""", cookie)
            .andExpect(status().isOk).andExpect(jsonPath("$.timeZone").value("America/Los_Angeles"))
        json(put("/api/parent/settings"), """{"timeZone":"UTC","parentIdleTimeoutSeconds":10}""", cookie)
            .andExpect(status().isBadRequest)
    }

    @Test
    fun `bootstrap lists children in position order and counts pending requests`() {
        val first = fixtures.createChild("Jane Doe")
        fixtures.createChild("John Doe")
        mvc.perform(get("/api/bootstrap"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.children[0].id").value(first))
            .andExpect(jsonPath("$.children[1].name").value("John Doe"))
            .andExpect(jsonPath("$.pendingPrizeRequestCount").value(0))
            .andExpect(jsonPath("$.parentIdleTimeoutSeconds").value(300))
    }
}
