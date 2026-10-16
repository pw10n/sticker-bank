package com.stickerbank.common

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class HeaderSampleController {
    @GetMapping("/api/test/ping")
    fun ping(): String = "pong"

    @PostMapping("/api/test/ping")
    fun postPing(): String = "pong"

    @PostMapping("/other/ping")
    fun otherPing(): String = "pong"
}

class ApiHeadersFilterTest {
    private lateinit var mvc: MockMvc

    private fun mvcWith(minFrontendVersion: String?): MockMvc = MockMvcBuilders.standaloneSetup(HeaderSampleController())
        .addFilters<org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder>(
            SecurityHeadersFilter(),
            ApiHeadersFilter(minFrontendVersion),
        )
        .build()

    @BeforeEach
    fun setUp() {
        mvc = mvcWith(null)
    }

    @Test
    fun `POST without the custom header is rejected`() {
        mvc.perform(post("/api/test/ping"))
            .andExpect(status().isForbidden)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.code").value("CSRF_HEADER_MISSING"))
            .andExpect(header().string("Cache-Control", "no-store"))
    }

    @Test
    fun `POST with the custom header passes`() {
        mvc.perform(post("/api/test/ping").header("X-Sticker-Bank", "1")).andExpect(status().isOk)
    }

    @Test
    fun `GET passes and is not cached`() {
        mvc.perform(get("/api/test/ping"))
            .andExpect(status().isOk)
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
    }

    @Test
    fun `paths outside api are not affected`() {
        mvc.perform(post("/other/ping"))
            .andExpect(status().isOk)
            .andExpect(header().doesNotExist("Cache-Control"))
    }

    @Test
    fun `security headers are on every response`() {
        mvc.perform(get("/api/test/ping"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("Referrer-Policy", "no-referrer"))
            .andExpect(header().exists("Content-Security-Policy"))
            .andExpect(header().exists("Permissions-Policy"))
            .andExpect(header().doesNotExist("Strict-Transport-Security"))
    }

    @Test
    fun `every api response carries the minimum frontend version`() {
        val versioned = mvcWith("1.2.0")
        versioned.perform(get("/api/test/ping")).andExpect(header().string("X-Min-Frontend-Version", "1.2.0"))
        versioned.perform(post("/api/test/ping").header("X-Sticker-Bank", "1"))
            .andExpect(header().string("X-Min-Frontend-Version", "1.2.0"))
    }

    @Test
    fun `a rejected request still tells the client its frontend is too old`() {
        mvcWith("1.2.0").perform(post("/api/test/ping"))
            .andExpect(status().isForbidden)
            .andExpect(header().string("X-Min-Frontend-Version", "1.2.0"))
    }

    @Test
    fun `no minimum means no header, and paths outside api never get it`() {
        mvc.perform(get("/api/test/ping")).andExpect(header().doesNotExist("X-Min-Frontend-Version"))
        mvcWith("1.2.0").perform(post("/other/ping")).andExpect(header().doesNotExist("X-Min-Frontend-Version"))
    }

    @Test
    fun `the minimum defaults to the server version and ignores a suffix`() {
        assertEquals("1.2.0", ApiHeadersFilter.resolveMinFrontendVersion(null, "1.2.0"))
        assertEquals("1.2.0", ApiHeadersFilter.resolveMinFrontendVersion("  ", "1.2.0"))
        assertEquals("1.2.0", ApiHeadersFilter.resolveMinFrontendVersion(null, "1.2.0-rc1"))
    }

    @Test
    fun `a dev or unparseable server version enforces nothing`() {
        assertNull(ApiHeadersFilter.resolveMinFrontendVersion(null, "dev"))
        assertNull(ApiHeadersFilter.resolveMinFrontendVersion("", "v1.2.0"))
        assertNull(ApiHeadersFilter.resolveMinFrontendVersion(null, "1.2"))
    }

    @Test
    fun `a configured minimum wins, and a malformed one fails startup`() {
        assertEquals("1.0.0", ApiHeadersFilter.resolveMinFrontendVersion(" 1.0.0 ", "2.0.0"))
        assertThrows<IllegalArgumentException> { ApiHeadersFilter.resolveMinFrontendVersion("latest", "2.0.0") }
        assertThrows<IllegalArgumentException> { ApiHeadersFilter.resolveMinFrontendVersion("1.2", "2.0.0") }
    }
}
