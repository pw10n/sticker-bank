package com.stickerbank.support

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class MutableClock(start: Instant = Instant.parse("2026-10-15T15:00:00Z")) : Clock() {
    @Volatile
    private var current: Instant = start

    fun set(instant: Instant) {
        current = instant
    }

    fun advance(duration: Duration) {
        current = current.plus(duration)
    }

    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId): Clock = fixedView(zone)

    override fun instant(): Instant = current

    private fun fixedView(zone: ZoneId): Clock {
        val parent = this
        return object : Clock() {
            override fun getZone(): ZoneId = zone

            override fun withZone(zone: ZoneId): Clock = parent.withZone(zone)

            override fun instant(): Instant = parent.instant()
        }
    }
}
