package com.stickerbank.sticker.earning

import com.stickerbank.common.StickerPickDto
import com.stickerbank.sticker.BookStickerDto
import com.stickerbank.sticker.PickClaimRequest
import com.stickerbank.sticker.StickerBookPageDto
import com.stickerbank.sticker.StickerDetailDto
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api")
class StickerController(private val pickService: StickerPickService, private val bookService: StickerBookService) {
    @GetMapping("/stickers/{stickerId}/pick")
    fun getPick(@PathVariable stickerId: Long): StickerPickDto = pickService.getPick(stickerId)

    @PostMapping("/stickers/{stickerId}/pick")
    fun claim(@PathVariable stickerId: Long, @Valid @RequestBody body: PickClaimRequest): BookStickerDto =
        pickService.claim(stickerId, body.designId)

    @GetMapping("/children/{childId}/stickers")
    fun book(
        @PathVariable childId: Long,
        @RequestParam(required = false) status: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ): StickerBookPageDto = bookService.page(childId, status, cursor, limit)

    @GetMapping("/stickers/{stickerId}")
    fun detail(@PathVariable stickerId: Long): StickerDetailDto = bookService.detail(stickerId)
}
