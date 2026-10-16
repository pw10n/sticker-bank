package com.stickerbank.common

enum class Actor { CHILD, PARENT }

enum class StickerStatus { UNCLAIMED, AVAILABLE, PENDING, USED, REVOKED }

/** How a routine's sticker was earned (TDD 6.8). Internal: the API only exposes `autoFinished`. */
enum class FinishMode { TAPPED, AUTO }
