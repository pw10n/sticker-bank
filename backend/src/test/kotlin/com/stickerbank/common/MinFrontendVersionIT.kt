package com.stickerbank.common

import com.stickerbank.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** The minimum frontend version travels from the property to every real /api response (TDD 9.5, TD-20). */
@IntegrationTest
@TestPropertySource(properties = ["sticker-bank.min-frontend-version=1.2.3"])
class MinFrontendVersionIT {
    @Autowired
    lateinit var mvc: MockMvc

    @Test
    fun `a configured minimum is on a normal response`() {
        mvc.perform(get("/api/bootstrap"))
            .andExpect(status().isOk)
            .andExpect(header().string("X-Min-Frontend-Version", "1.2.3"))
    }

    @Test
    fun `and on an error response, so a stale app learns of it whatever it called`() {
        mvc.perform(post("/api/parent/session/touch"))
            .andExpect(status().isForbidden)
            .andExpect(header().string("X-Min-Frontend-Version", "1.2.3"))
    }
}
