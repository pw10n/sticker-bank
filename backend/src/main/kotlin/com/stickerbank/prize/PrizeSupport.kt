package com.stickerbank.prize

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import java.util.Base64

/** Pure helpers: prize text/note normalisation and the keyset cursor codec. */
object PrizeSupport {
    const val MAX_PRIZE_TEXT = 200
    const val MAX_NOTE = 500
    const val DEFAULT_LIMIT = 50
    const val MAX_LIMIT = 200

    fun validation(field: String, message: String): DomainException =
        DomainException(ErrorCode.VALIDATION_FAILED, null, mapOf("fieldErrors" to listOf(FieldErrorDto(field, message))))

    fun normalizePrizeText(raw: String?): String {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) throw validation("prizeText", "Please say what prize was given")
        if (text.length > MAX_PRIZE_TEXT) throw validation("prizeText", "Must be at most $MAX_PRIZE_TEXT characters")
        return text
    }

    fun normalizeNote(raw: String?): String? {
        val note = raw?.trim().orEmpty()
        if (note.length > MAX_NOTE) throw validation("note", "Must be at most $MAX_NOTE characters")
        return note.ifEmpty { null }
    }

    fun validateStickerIds(ids: List<Long>?) {
        if (ids.isNullOrEmpty()) throw validation("stickerIds", "Pick at least one sticker")
        if (ids.toSet().size != ids.size) throw validation("stickerIds", "Each sticker can only be picked once")
    }

    fun validateLimit(limit: Int): Int {
        if (limit < 1 || limit > MAX_LIMIT) throw validation("limit", "Must be between 1 and $MAX_LIMIT")
        return limit
    }
}

data class PrizeCursor(val createdAtMillis: Long, val id: Long)

object PrizeCursorCodec {
    fun encode(cursor: PrizeCursor): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString("${cursor.createdAtMillis}:${cursor.id}".toByteArray(Charsets.UTF_8))

    fun decode(raw: String): PrizeCursor {
        try {
            val parts = String(Base64.getUrlDecoder().decode(raw), Charsets.UTF_8).split(':')
            require(parts.size == 2)
            return PrizeCursor(parts[0].toLong(), parts[1].toLong())
        } catch (_: IllegalArgumentException) {
            throw PrizeSupport.validation("cursor", "Invalid cursor")
        }
    }
}
