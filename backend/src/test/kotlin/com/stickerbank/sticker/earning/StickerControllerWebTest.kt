package com.stickerbank.sticker.earning

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@WebMvcTest(StickerController::class)
class StickerControllerWebTest {
    @Autowired lateinit var mvc: MockMvc

    @MockkBean lateinit var parentSessionReader: ParentSessionReader

    @MockkBean lateinit var pickService: StickerPickService

    @MockkBean lateinit var bookService: StickerBookService

    private fun claim() = post("/api/stickers/5/pick").header("X-Sticker-Bank", "1")
        .contentType(MediaType.APPLICATION_JSON).content("""{"designId": 9}""")

    @Test
    fun `already claimed is 409`() {
        every { pickService.claim(5, 9) } throws DomainException(ErrorCode.ALREADY_CLAIMED)
        mvc.perform(claim()).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("ALREADY_CLAIMED"))
    }

    @Test
    fun `not offered is 422`() {
        every { pickService.claim(5, 9) } throws DomainException(ErrorCode.CHOICE_NOT_OFFERED)
        mvc.perform(claim()).andExpect(status().`is`(422)).andExpect(jsonPath("$.code").value("CHOICE_NOT_OFFERED"))
    }

    @Test
    fun `unknown sticker is 404`() {
        every { pickService.getPick(5) } throws DomainException(ErrorCode.NOT_FOUND)
        mvc.perform(get("/api/stickers/5/pick")).andExpect(status().isNotFound)
    }

    @Test
    fun `bad status or limit is 400`() {
        every { bookService.page(1, "UNCLAIMED", null, null) } throws
            DomainException(ErrorCode.VALIDATION_FAILED, null, mapOf("fieldErrors" to listOf(FieldErrorDto("status", "bad"))))
        every { bookService.page(1, null, null, 0) } throws DomainException(ErrorCode.VALIDATION_FAILED)
        mvc.perform(get("/api/children/1/stickers?status=UNCLAIMED")).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
        mvc.perform(get("/api/children/1/stickers?limit=0")).andExpect(status().isBadRequest)
        mvc.perform(get("/api/children/1/stickers?limit=abc")).andExpect(status().isBadRequest)
    }
}
