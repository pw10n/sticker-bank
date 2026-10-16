package com.stickerbank.child

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.NotBlank
import java.time.Instant

data class ChildInput(
    // Length (1-40 code points, after trimming) is enforced by ChildNameRules; maxLength here is documentation only.
    @field:NotBlank @field:Schema(maxLength = 40) val name: String,
    @field:NotBlank val avatarKey: String,
    @field:NotBlank val themeColor: String,
)

data class ChildDto(
    val id: Long,
    val name: String,
    val avatarKey: String,
    val themeColor: String,
    val position: Int,
    val createdAt: Instant,
)
