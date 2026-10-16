package com.stickerbank.common

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

fun interface FamilyZoneSource {
    fun zone(): ZoneId
}

@Component
class JdbcFamilyZoneSource(private val jdbc: JdbcClient) : FamilyZoneSource {
    override fun zone(): ZoneId = ZoneId.of(
        jdbc.sql("SELECT time_zone FROM family_settings WHERE id = 1")
            .query(String::class.java)
            .single(),
    )
}

@Component
class FamilyClock(private val clock: Clock, private val zoneSource: FamilyZoneSource) {
    fun now(): Instant = clock.instant()

    fun zone(): ZoneId = zoneSource.zone()

    fun today(): LocalDate = LocalDate.now(clock.withZone(zone()))

    /** Start of the next family-local day; DST-safe because it goes through [java.time.LocalDate.atStartOfDay]. */
    fun nextDayStartsAt(): Instant {
        val zone = zone()
        return LocalDate.now(clock.withZone(zone)).plusDays(1).atStartOfDay(zone).toInstant()
    }
}
