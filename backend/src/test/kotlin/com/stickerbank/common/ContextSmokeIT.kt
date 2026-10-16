package com.stickerbank.common

import com.stickerbank.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@IntegrationTest
class ContextSmokeIT {
    @Autowired
    lateinit var mvc: MockMvc

    @Test
    fun `context loads and openapi is served`() {
        mvc.perform(get("/api/openapi.json")).andExpect(status().isOk)
    }
}
