package com.stickerbank.common

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate

class WeekdaysTest {
    @Test
    fun `mask uses bit 0 for Monday and bit 6 for Sunday`() {
        assertEquals(0b0000001, Weekdays.toMask(listOf(Weekday.MON)))
        assertEquals(0b1000000, Weekdays.toMask(listOf(Weekday.SUN)))
        assertEquals(0b0010101, Weekdays.toMask(listOf(Weekday.WED, Weekday.MON, Weekday.FRI)))
        assertEquals(Weekdays.ALL, Weekdays.toMask(Weekday.entries))
        assertEquals(0, Weekdays.toMask(emptyList()))
    }

    @Test
    fun `fromMask returns days ordered Monday to Sunday`() {
        assertEquals(listOf(Weekday.MON, Weekday.WED, Weekday.FRI), Weekdays.fromMask(0b0010101))
        assertEquals(Weekday.entries, Weekdays.fromMask(Weekdays.ALL))
        assertEquals(emptyList<Weekday>(), Weekdays.fromMask(0))
    }

    @Test
    fun `index maps Monday to 0 and Sunday to 6`() {
        assertEquals(0, Weekdays.index(LocalDate.of(2026, 10, 12)))
        assertEquals(3, Weekdays.index(LocalDate.of(2026, 10, 15)))
        assertEquals(6, Weekdays.index(LocalDate.of(2026, 10, 18)))
    }

    @Test
    fun `includes checks the bit for the date weekday`() {
        val weekdaysOnly = Weekdays.toMask(listOf(Weekday.MON, Weekday.TUE, Weekday.WED, Weekday.THU, Weekday.FRI))
        assertTrue(Weekdays.includes(weekdaysOnly, LocalDate.of(2026, 10, 15)))
        assertFalse(Weekdays.includes(weekdaysOnly, LocalDate.of(2026, 10, 17)))
        assertFalse(Weekdays.includes(weekdaysOnly, LocalDate.of(2026, 10, 18)))
    }
}
