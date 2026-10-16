package com.stickerbank.family

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import java.time.Instant
import java.time.LocalDate

const val PIN_REGEX = "^\\d{4}$"

data class ChildSummaryDto(val id: Long, val name: String, val avatarKey: String, val themeColor: String, val position: Int)

data class BootstrapDto(
    val setupRequired: Boolean,
    val today: LocalDate,
    val nextDayStartsAt: Instant,
    val serverTime: Instant,
    val timeZone: String,
    val children: List<ChildSummaryDto>,
    val pendingPrizeRequestCount: Int,
    val parentIdleTimeoutSeconds: Int,
    val appVersion: String,
)

data class PinSetupRequest(@field:Pattern(regexp = PIN_REGEX) val pin: String, @field:NotBlank val timeZone: String)

data class PinChangeRequest(
    @field:Pattern(regexp = PIN_REGEX) val currentPin: String,
    @field:Pattern(regexp = PIN_REGEX) val newPin: String,
)

data class UnlockRequest(@field:Pattern(regexp = PIN_REGEX) val pin: String)

data class ParentSessionDto(val idleTimeoutSeconds: Int, val idleExpiresAt: Instant, val absoluteExpiresAt: Instant)

data class PinResetDto(val resetAt: Instant, val adminName: String)

data class SettingsDto(val timeZone: String, val parentIdleTimeoutSeconds: Int, val pinSetAt: Instant?, val lastPinReset: PinResetDto?)

data class SettingsUpdateRequest(@field:NotBlank val timeZone: String, @field:Min(60) @field:Max(3600) val parentIdleTimeoutSeconds: Int)
