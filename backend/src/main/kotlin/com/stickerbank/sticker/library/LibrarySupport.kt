package com.stickerbank.sticker.library

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto

/** Pure helpers for the sticker library (LIKE escaping, name validation). */
object LibrarySupport {
    const val MAX_NAME = 40

    /** Escapes `\`, `%` and `_` so user text is matched literally inside a LIKE pattern (escape char is backslash). */
    fun escapeLike(text: String): String = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    /** Trims and validates a name (1 to 40 characters); throws VALIDATION_FAILED for [field] otherwise. */
    fun validName(raw: String, field: String = "name"): String {
        val name = raw.trim()
        if (name.isEmpty() || name.length > MAX_NAME) {
            throw validation(field, "Name must be 1 to $MAX_NAME characters")
        }
        return name
    }

    fun validation(field: String, message: String): DomainException =
        DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto(field, message))))
}
