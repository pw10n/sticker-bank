package com.stickerbank.common

import java.time.LocalDate

/** DB mask: bit 0 = MON ... bit 6 = SUN. */
enum class Weekday { MON, TUE, WED, THU, FRI, SAT, SUN }

object Weekdays {
    const val ALL: Int = 0b1111111

    fun toMask(days: Collection<Weekday>): Int = days.fold(0) { mask, day -> mask or (1 shl day.ordinal) }

    fun fromMask(mask: Int): List<Weekday> = Weekday.entries.filter { mask and (1 shl it.ordinal) != 0 }

    /** MON=0 ... SUN=6. */
    fun index(date: LocalDate): Int = date.dayOfWeek.value - 1

    fun includes(mask: Int, date: LocalDate): Boolean = mask and (1 shl index(date)) != 0
}
