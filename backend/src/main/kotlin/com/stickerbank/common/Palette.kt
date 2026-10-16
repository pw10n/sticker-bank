package com.stickerbank.common

object Palette {
    val COLORS: Set<String> =
        setOf(
            "#FFB703", "#FB8500", "#FF6B8B", "#F7A8D8", "#B388EB",
            "#90CAF9", "#4CC9F0", "#56CFA1", "#8BC34A", "#E9C46A",
        )

    /** Case-insensitive match; callers store the upper-case form. */
    fun require(color: String?, field: String, nullable: Boolean) {
        if (color == null && nullable) return
        if (color == null || color.uppercase() !in COLORS) {
            throw DomainException(
                ErrorCode.VALIDATION_FAILED,
                properties = mapOf("fieldErrors" to listOf(FieldErrorDto(field, "Unknown color"))),
            )
        }
    }
}
