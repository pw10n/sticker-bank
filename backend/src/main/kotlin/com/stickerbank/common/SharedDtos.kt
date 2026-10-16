package com.stickerbank.common

import java.time.LocalDate

data class DesignRefDto(val designId: Long, val name: String, val artworkKey: String)

data class StickerPickDto(
    val stickerId: Long,
    val childId: Long,
    val chartDate: LocalDate,
    val routineName: String?,
    val status: StickerStatus,
    val autoAwarded: Boolean,
    val choices: List<DesignRefDto>,
    val claimed: DesignRefDto?,
)
