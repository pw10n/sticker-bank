package com.stickerbank.family

import com.stickerbank.common.AppVersion
import com.stickerbank.common.FamilyClock
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDateTime

@Service
class BootstrapService(
    private val jdbc: JdbcClient,
    private val clock: Clock,
    private val familyClock: FamilyClock,
    private val appVersion: AppVersion,
) {
    fun bootstrap(): BootstrapDto {
        val row = jdbc.sql(
            "SELECT pin_hash IS NULL AS setup_required, time_zone, parent_idle_timeout_sec FROM family_settings WHERE id = 1",
        )
            .query { rs, _ -> Triple(rs.getBoolean("setup_required"), rs.getString("time_zone"), rs.getInt("parent_idle_timeout_sec")) }
            .single()
        val children = jdbc.sql(
            "SELECT id, name, avatar_key, theme_color, position FROM child WHERE archived_at IS NULL ORDER BY position, id",
        ).query { rs, _ ->
            ChildSummaryDto(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("avatar_key"),
                rs.getString("theme_color"),
                rs.getInt("position"),
            )
        }.list()
        val pending = jdbc.sql("SELECT COUNT(*) FROM prize_request WHERE status = 'PENDING'").query(Int::class.java).single()
        return BootstrapDto(
            setupRequired = row.first,
            today = familyClock.today(),
            nextDayStartsAt = familyClock.nextDayStartsAt(),
            serverTime = clock.instant(),
            timeZone = row.second,
            children = children,
            pendingPrizeRequestCount = pending,
            parentIdleTimeoutSeconds = row.third,
            appVersion = appVersion.value,
        )
    }
}

@Service
class FamilySettingsService(private val jdbc: JdbcClient, private val clock: Clock) {
    fun get(): SettingsDto {
        val lastReset = jdbc.sql("SELECT reset_at, admin_name FROM pin_reset_log ORDER BY reset_at DESC, id DESC LIMIT 1")
            .query { rs, _ -> PinResetDto(utc(rs.getObject("reset_at", LocalDateTime::class.java)), rs.getString("admin_name")) }
            .optional().orElse(null)
        return jdbc.sql("SELECT time_zone, parent_idle_timeout_sec, pin_set_at FROM family_settings WHERE id = 1").query { rs, _ ->
            SettingsDto(
                rs.getString("time_zone"),
                rs.getInt("parent_idle_timeout_sec"),
                rs.getObject("pin_set_at", LocalDateTime::class.java)?.let { utc(it) },
                lastReset,
            )
        }.single()
    }

    fun update(request: SettingsUpdateRequest): SettingsDto {
        requireIanaZone("timeZone", request.timeZone)
        jdbc.sql("UPDATE family_settings SET time_zone = ?, parent_idle_timeout_sec = ?, updated_at = ? WHERE id = 1")
            .params(request.timeZone, request.parentIdleTimeoutSeconds, utc(clock.instant())).update()
        return get()
    }
}
