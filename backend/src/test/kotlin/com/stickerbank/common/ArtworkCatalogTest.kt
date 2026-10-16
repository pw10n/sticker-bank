package com.stickerbank.common

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ArtworkCatalogTest {
    private val catalog = ArtworkCatalog()

    @Test
    fun `exists respects the use`() {
        assertTrue(catalog.exists("whale", ArtworkUse.STICKER))
        assertFalse(catalog.exists("whale", ArtworkUse.TASK))
        assertTrue(catalog.exists("toothbrush", ArtworkUse.TASK))
        assertTrue(catalog.exists("crescent-moon", ArtworkUse.ROUTINE))
        assertTrue(catalog.exists("panda", ArtworkUse.AVATAR))
        assertTrue(catalog.exists("panda", ArtworkUse.STICKER))
        assertFalse(catalog.exists("does-not-exist", ArtworkUse.STICKER))
    }

    @Test
    fun `require throws a validation failure naming the field`() {
        catalog.require("sun", ArtworkUse.ROUTINE, "iconKey")
        val e = assertThrows<DomainException> { catalog.require("nope", ArtworkUse.ROUTINE, "iconKey") }
        assertEquals(ErrorCode.VALIDATION_FAILED, e.code)
        assertEquals(listOf(FieldErrorDto("iconKey", "Unknown artwork")), e.properties["fieldErrors"])
    }

    @Test
    fun `palette accepts configured colors case-insensitively`() {
        Palette.require("#ffb703", "themeColor", nullable = false)
        Palette.require(null, "color", nullable = true)
        assertThrows<DomainException> { Palette.require(null, "themeColor", nullable = false) }
        assertThrows<DomainException> { Palette.require("#000000", "themeColor", nullable = true) }
    }

    @Test
    fun `parent session cookie helpers`() {
        val token = ParentSessionCookie.newToken()
        assertEquals(43, token.length)
        assertEquals(32, ParentSessionCookie.hash(token).size)
        assertFalse(token == ParentSessionCookie.newToken())
    }
}
