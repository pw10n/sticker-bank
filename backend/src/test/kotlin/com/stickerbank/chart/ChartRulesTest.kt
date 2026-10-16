package com.stickerbank.chart

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.StickerStatus
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ChartRulesTest {
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    private fun state(skipped: Boolean = false, sticker: StickerStatus? = null, date: LocalDate = today, done: Int = 0, count: Int = 2) =
        ChartRules.deriveState(skipped, sticker, date, today, done, count)

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
    fun `every task done without a sticker is ready to finish and earns nothing yet`() {
        assertThat(state(done = 2)).isEqualTo(RoutineDayState.READY_TO_FINISH)
        assertThat(state(done = 1, count = 1)).isEqualTo(RoutineDayState.READY_TO_FINISH)
        // a past day only gets here after a parent checked the last task there (TDD 7.3, 7.12)
        assertThat(state(date = yesterday, done = 2)).isEqualTo(RoutineDayState.READY_TO_FINISH)
        // one task short is still in progress today and missed on a past day
        assertThat(state(done = 1)).isEqualTo(RoutineDayState.IN_PROGRESS)
        assertThat(state(date = yesterday, done = 1)).isEqualTo(RoutineDayState.MISSED)
    }

    @Test
    fun `ready to finish yields to a skip and to any live sticker`() {
        assertThat(state(skipped = true, done = 2)).isEqualTo(RoutineDayState.SKIPPED)
        assertThat(state(sticker = StickerStatus.UNCLAIMED, done = 2)).isEqualTo(RoutineDayState.AWAITING_PICK)
        assertThat(state(sticker = StickerStatus.AVAILABLE, done = 2)).isEqualTo(RoutineDayState.EARNED)
    }

    @Test
    fun `a revoked sticker leaves the routine ready to finish only once every task is done again`() {
        // the revoke unchecked a task, so the routine is back in progress today and missed on a past day
        assertThat(state(done = 1)).isEqualTo(RoutineDayState.IN_PROGRESS)
        assertThat(state(date = yesterday, done = 1)).isEqualTo(RoutineDayState.MISSED)
        assertThat(state(done = 2)).isEqualTo(RoutineDayState.READY_TO_FINISH)
    }

    @Test
    fun `end of day is the start of the next day in the family zone`() {
        val utc = ZoneId.of("UTC")
        assertThat(ChartRules.endOfDay(LocalDate.of(2026, 10, 15), utc)).isEqualTo(Instant.parse("2026-10-16T00:00:00Z"))
        val la = ZoneId.of("America/Los_Angeles")
        assertThat(ChartRules.endOfDay(LocalDate.of(2026, 10, 15), la)).isEqualTo(Instant.parse("2026-10-16T07:00:00Z"))
    }

    @Test
    fun `end of day follows daylight saving changes`() {
        val la = ZoneId.of("America/Los_Angeles")
        // 2026-11-01 is 25 hours long in Los Angeles (clocks go back), so its end is 08:00Z the next day
        assertThat(ChartRules.endOfDay(LocalDate.of(2026, 11, 1), la)).isEqualTo(Instant.parse("2026-11-02T08:00:00Z"))
        // 2026-03-08 is 23 hours long (clocks go forward), so its end is 07:00Z the next day
        assertThat(ChartRules.endOfDay(LocalDate.of(2026, 3, 8), la)).isEqualTo(Instant.parse("2026-03-09T07:00:00Z"))
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
