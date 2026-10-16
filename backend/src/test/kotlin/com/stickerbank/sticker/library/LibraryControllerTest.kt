package com.stickerbank.sticker.library

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.ParentSessionReader
import com.stickerbank.sticker.DesignInput
import io.mockk.every
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@WebMvcTest(LibraryController::class, StickerCategoryController::class)
class LibraryControllerTest {
    @Autowired lateinit var mvc: MockMvc

    @MockkBean lateinit var service: LibraryService

    @MockkBean lateinit var sessions: ParentSessionReader

    private fun allowSession() {
        every { sessions.hasValidSession(any()) } returns true
    }

    @Test
    fun `blank name gives 400 with field errors`() {
        allowSession()
        mvc.perform(
            post("/api/parent/library/designs").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON)
                .content("""{"name":"","artworkKey":"rocket"}"""),
        ).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
    }

    @Test
    fun `delete of used design gives 409`() {
        allowSession()
        every { service.delete(5) } throws DomainException(ErrorCode.DESIGN_IN_USE, "This sticker has been earned. Retire it instead.")
        mvc.perform(delete("/api/parent/library/designs/5").header("X-Sticker-Bank", "1"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
            .andExpect(jsonPath("$.detail").value("This sticker has been earned. Retire it instead."))
    }

    @Test
    fun `unknown design gives 404`() {
        allowSession()
        every { service.update(9, any<DesignInput>()) } throws DomainException(ErrorCode.NOT_FOUND)
        mvc.perform(
            put("/api/parent/library/designs/9").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON)
                .content("""{"name":"Rocket","artworkKey":"rocket"}"""),
        ).andExpect(status().isNotFound).andExpect(jsonPath("$.code").value("NOT_FOUND"))
    }
}
