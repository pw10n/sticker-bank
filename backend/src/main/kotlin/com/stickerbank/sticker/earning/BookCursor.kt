package com.stickerbank.sticker.earning

import java.time.LocalDate
import java.time.LocalDateTime
import java.util.Base64

/** Opaque keyset cursor: base64url of the last row's (chart_date, earned_at, id). */
data class BookCursor(val chartDate: LocalDate, val earnedAt: LocalDateTime, val id: Long) {
    fun encode(): String = Base64.getUrlEncoder().withoutPadding().encodeToString("$chartDate|$earnedAt|$id".toByteArray(Charsets.UTF_8))

    companion object {
        /** Returns null when the cursor is malformed. */
        fun decode(raw: String): BookCursor? = try {
            val parts = String(Base64.getUrlDecoder().decode(raw), Charsets.UTF_8).split("|")
            if (parts.size != 3) {
                null
            } else {
                BookCursor(LocalDate.parse(parts[0]), LocalDateTime.parse(parts[1]), parts[2].toLong())
            }
        } catch (_: RuntimeException) {
            null
        }
    }
}
