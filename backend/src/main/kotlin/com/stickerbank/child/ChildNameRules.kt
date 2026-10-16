package com.stickerbank.child

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto

/** Child name normalisation (TDD 10.2): trimmed, 1-40 characters (Unicode code points, so an emoji counts as one). */
object ChildNameRules {
    const val MAX_LENGTH = 40

    fun normalize(raw: String): String {
        val name = raw.trim()
        val length = name.codePointCount(0, name.length)
        if (length < 1 || length > MAX_LENGTH) {
            throw DomainException(
                ErrorCode.VALIDATION_FAILED,
                properties = mapOf("fieldErrors" to listOf(FieldErrorDto("name", "Name must be 1 to $MAX_LENGTH characters"))),
            )
        }
        return name
    }
}
