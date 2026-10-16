package com.stickerbank.common

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
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

    @BeforeEach
    fun setUp() {
        mvc =
            MockMvcBuilders.standaloneSetup(HeaderSampleController())
                .addFilters<org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder>(
                    SecurityHeadersFilter(),
                    ApiHeadersFilter(),
                )
                .build()
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
}
