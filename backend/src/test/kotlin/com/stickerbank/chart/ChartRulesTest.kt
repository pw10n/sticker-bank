package com.stickerbank.chart

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.StickerStatus
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import java.time.LocalDate

class ChartRulesTest {
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    private fun state(skipped: Boolean = false, sticker: StickerStatus? = null, date: LocalDate = today, done: Int = 0) =
        ChartRules.deriveState(skipped, sticker, date, today, done)

    @Test
    fun `state table`() {
        assertThat(state()).isEqualTo(RoutineDayState.NOT_STARTED)
        assertThat(state(done = 1)).isEqualTo(RoutineDayState.IN_PROGRESS)
        assertThat(state(sticker = StickerStatus.UNCLAIMED, done = 2)).isEqualTo(RoutineDayState.AWAITING_PICK)
        assertThat(state(sticker = StickerStatus.AVAILABLE, done = 2)).isEqualTo(RoutineDayState.EARNED)
        assertThat(state(sticker = StickerStatus.USED, date = yesterday, done = 2)).isEqualTo(RoutineDayState.EARNED)
        assertThat(state(date = yesterday)).isEqualTo(RoutineDayState.MISSED)
        assertThat(state(date = yesterday, done = 1)).isEqualTo(RoutineDayState.MISSED)
        assertThat(state(skipped = true)).isEqualTo(RoutineDayState.SKIPPED)
    }

    @Test
    fun `priority skipped over sticker over missed`() {
        assertThat(state(skipped = true, sticker = StickerStatus.AVAILABLE, date = yesterday)).isEqualTo(RoutineDayState.SKIPPED)
        assertThat(state(sticker = StickerStatus.UNCLAIMED, date = yesterday)).isEqualTo(RoutineDayState.AWAITING_PICK)
    }

    @Test
    fun `removed tasks do not count`() {
        assertThat(ChartRules.doneCount(listOf(1L, 2L), setOf(1L, 99L))).isEqualTo(1)
        assertThat(ChartRules.doneCount(listOf(1L, 2L), emptySet())).isEqualTo(0)
    }

    @Test
    fun `date parsing`() {
        assertThat(ChartRules.parseDate("today", today)).isEqualTo(today)
        assertThat(ChartRules.parseDate("2026-10-01", today)).isEqualTo(LocalDate.of(2026, 10, 1))
        assertThatThrownBy { ChartRules.parseDate("10/01/2026", today) }
            .isInstanceOfSatisfying(DomainException::class.java) { assertThat(it.code).isEqualTo(ErrorCode.VALIDATION_FAILED) }
        assertThatThrownBy { ChartRules.parsePastOrToday("2026-10-16", today) }
            .isInstanceOfSatisfying(DomainException::class.java) { assertThat(it.code).isEqualTo(ErrorCode.FUTURE_DATE) }
        assertThat(ChartRules.parsePastOrToday("2026-10-15", today)).isEqualTo(today)
    }

    private fun invalid(from: String?, to: String?): DomainException {
        val e = org.junit.jupiter.api.Assertions.assertThrows(DomainException::class.java) { ChartRules.validateRange(from, to, today) }
        assertThat(e.code).isEqualTo(ErrorCode.VALIDATION_FAILED)
        return e
    }

    @Test
    fun `range validation`() {
        assertThat(ChartRules.validateRange("2026-10-09", "2026-10-15", today)).isEqualTo(LocalDate.of(2026, 10, 9) to today)
        // exactly 62 days inclusive
        assertThat(ChartRules.validateRange("2026-08-15", "2026-10-15", today).first).isEqualTo(LocalDate.of(2026, 8, 15))
        invalid("2026-08-14", "2026-10-15")
        invalid("2026-10-10", "2026-10-09")
        invalid("2026-10-10", "2026-10-16")
        invalid(null, "2026-10-10")
        invalid("2026-10-10", null)
        invalid("nope", "2026-10-10")
        assertThat(invalid("2026-10-10", "2026-10-16").properties["fieldErrors"].toString()).contains("to")
    }
}
