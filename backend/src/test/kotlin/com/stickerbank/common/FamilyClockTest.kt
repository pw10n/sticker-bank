package com.stickerbank.common

import com.stickerbank.support.MutableClock
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class FamilyClockTest {
    private fun clockIn(zone: String, at: String): FamilyClock =
        FamilyClock(MutableClock(Instant.parse(at)), FamilyZoneSource { ZoneId.of(zone) })

    @Test
    fun `today follows the family zone`() {
        assertEquals(LocalDate.of(2026, 10, 15), clockIn("UTC", "2026-10-15T23:59:59Z").today())
        assertEquals(LocalDate.of(2026, 10, 16), clockIn("Pacific/Auckland", "2026-10-15T23:59:59Z").today())
    }

    @Test
    fun `day rolls over exactly at local midnight`() {
        assertEquals(LocalDate.of(2026, 10, 15), clockIn("America/New_York", "2026-10-16T03:59:59Z").today())
        assertEquals(LocalDate.of(2026, 10, 16), clockIn("America/New_York", "2026-10-16T04:00:00Z").today())
    }

    @Test
    fun `nextDayStartsAt is the next local midnight`() {
        assertEquals(Instant.parse("2026-10-16T04:00:00Z"), clockIn("America/New_York", "2026-10-15T15:00:00Z").nextDayStartsAt())
    }

    @Test
    fun `nextDayStartsAt is DST safe in New York`() {
        // spring forward on 2026-03-08 (that day is 23h long)
        assertEquals(Instant.parse("2026-03-08T05:00:00Z"), clockIn("America/New_York", "2026-03-07T12:00:00Z").nextDayStartsAt())
        assertEquals(Instant.parse("2026-03-09T04:00:00Z"), clockIn("America/New_York", "2026-03-08T12:00:00Z").nextDayStartsAt())
        // fall back on 2026-11-01 (that day is 25h long)
        assertEquals(Instant.parse("2026-11-02T05:00:00Z"), clockIn("America/New_York", "2026-11-01T12:00:00Z").nextDayStartsAt())
    }

    @Test
    fun `nextDayStartsAt is DST safe in London`() {
        // BST starts 2026-03-29 at 01:00 UTC
        assertEquals(Instant.parse("2026-03-29T00:00:00Z"), clockIn("Europe/London", "2026-03-28T12:00:00Z").nextDayStartsAt())
        assertEquals(Instant.parse("2026-03-29T23:00:00Z"), clockIn("Europe/London", "2026-03-29T12:00:00Z").nextDayStartsAt())
    }

    @Test
    fun `zone is read on every call`() {
        var zone = ZoneId.of("UTC")
        val clock = FamilyClock(MutableClock(Instant.parse("2026-10-15T23:30:00Z")), FamilyZoneSource { zone })
        assertEquals(LocalDate.of(2026, 10, 15), clock.today())
        zone = ZoneId.of("Asia/Tokyo")
        assertEquals(LocalDate.of(2026, 10, 16), clock.today())
    }
}
