package com.stickerbank.prize

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import java.util.Base64

class PrizeSupportTest {
    @Test
    fun `prize text is trimmed and required`() {
        assertThat(PrizeSupport.normalizePrizeText("  Ice cream  ")).isEqualTo("Ice cream")
        assertThatThrownBy { PrizeSupport.normalizePrizeText("   ") }.isInstanceOf(DomainException::class.java)
            .extracting { (it as DomainException).code }.isEqualTo(ErrorCode.VALIDATION_FAILED)
        assertThatThrownBy { PrizeSupport.normalizePrizeText("x".repeat(201)) }.isInstanceOf(DomainException::class.java)
        assertThat(PrizeSupport.normalizePrizeText("x".repeat(200))).hasSize(200)
    }

    @Test
    fun `note is trimmed and blank becomes null`() {
        assertThat(PrizeSupport.normalizeNote("  hi ")).isEqualTo("hi")
        assertThat(PrizeSupport.normalizeNote("   ")).isNull()
        assertThat(PrizeSupport.normalizeNote(null)).isNull()
        assertThatThrownBy { PrizeSupport.normalizeNote("n".repeat(501)) }.isInstanceOf(DomainException::class.java)
    }

    @Test
    fun `sticker ids must be non empty and unique`() {
        assertThatThrownBy { PrizeSupport.validateStickerIds(emptyList()) }.isInstanceOf(DomainException::class.java)
        assertThatThrownBy { PrizeSupport.validateStickerIds(listOf(1, 1)) }.isInstanceOf(DomainException::class.java)
        PrizeSupport.validateStickerIds(listOf(1, 2))
    }

    @Test
    fun `limit is bounded`() {
        assertThat(PrizeSupport.validateLimit(1)).isEqualTo(1)
        assertThat(PrizeSupport.validateLimit(200)).isEqualTo(200)
        assertThatThrownBy { PrizeSupport.validateLimit(0) }.isInstanceOf(DomainException::class.java)
        assertThatThrownBy { PrizeSupport.validateLimit(201) }.isInstanceOf(DomainException::class.java)
    }

    @Test
    fun `cursor round trips and rejects garbage`() {
        val cursor = PrizeCursor(1_760_540_400_123, 42)
        val encoded = PrizeCursorCodec.encode(cursor)
        assertThat(encoded).doesNotContain("=", "+", "/")
        assertThat(PrizeCursorCodec.decode(encoded)).isEqualTo(cursor)
        assertThatThrownBy { PrizeCursorCodec.decode("!!!") }.isInstanceOf(DomainException::class.java)
        val bad = Base64.getUrlEncoder().withoutPadding().encodeToString("abc".toByteArray())
        assertThatThrownBy { PrizeCursorCodec.decode(bad) }.isInstanceOf(DomainException::class.java)
        val bad2 = Base64.getUrlEncoder().withoutPadding().encodeToString("a:b".toByteArray())
        assertThatThrownBy { PrizeCursorCodec.decode(bad2) }.isInstanceOf(DomainException::class.java)
    }
}
