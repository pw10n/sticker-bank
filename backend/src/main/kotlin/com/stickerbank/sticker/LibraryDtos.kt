package com.stickerbank.sticker

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

enum class DesignStatus { ACTIVE, RETIRED }

data class DesignInput(
    @field:NotBlank @field:Size(max = 40) val name: String,
    @field:NotBlank val artworkKey: String,
    val categoryId: Long?,
)

data class DesignStatusRequest(val status: DesignStatus)

data class DesignDto(
    val id: Long,
    val name: String,
    val artworkKey: String,
    val categoryId: Long?,
    val categoryName: String?,
    val status: DesignStatus,
    val inUse: Boolean,
    val createdAt: Instant,
)

data class LibraryDto(val activeCount: Int, val designs: List<DesignDto>)

data class CategoryInput(@field:NotBlank @field:Size(max = 40) val name: String, val enabled: Boolean = true)

data class CategoryDto(val id: Long, val name: String, val enabled: Boolean, val position: Int, val designCount: Int)
