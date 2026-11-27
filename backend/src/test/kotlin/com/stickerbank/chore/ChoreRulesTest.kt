package com.stickerbank.chore

import com.stickerbank.common.StickerStatus
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.time.LocalDate

class ChoreRulesTest {
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    private fun state(sticker: StickerStatus? = null, due: LocalDate? = null, done: Int = 0, count: Int = 2) =
        ChoreRules.deriveState(sticker, due, today, done, count)

    @Test
    fun `state table in row order`() {
        assertThat(state()).isEqualTo(ChoreState.NOT_STARTED)
        assertThat(state(done = 1)).isEqualTo(ChoreState.IN_PROGRESS)
        assertThat(state(done = 2)).isEqualTo(ChoreState.READY_TO_FINISH)
        assertThat(state(done = 1, count = 1)).isEqualTo(ChoreState.READY_TO_FINISH)
        assertThat(state(sticker = StickerStatus.UNCLAIMED, done = 2)).isEqualTo(ChoreState.AWAITING_PICK)
        assertThat(state(sticker = StickerStatus.AVAILABLE, done = 2)).isEqualTo(ChoreState.EARNED)
        assertThat(state(sticker = StickerStatus.USED, done = 2)).isEqualTo(ChoreState.EARNED)
    }

    @Test
    fun `a live sticker beats a past due date`() {
        assertThat(state(sticker = StickerStatus.UNCLAIMED, due = yesterday, done = 2)).isEqualTo(ChoreState.AWAITING_PICK)
        assertThat(state(sticker = StickerStatus.AVAILABLE, due = yesterday, done = 2)).isEqualTo(ChoreState.EARNED)
    }

    @Test
    fun `missed beats ready to finish and in progress`() {
        assertThat(state(due = yesterday)).isEqualTo(ChoreState.MISSED)
        assertThat(state(due = yesterday, done = 1)).isEqualTo(ChoreState.MISSED)
        assertThat(state(due = yesterday, done = 2)).isEqualTo(ChoreState.MISSED)
    }

    @Test
    fun `due today is not missed`() {
        assertThat(state(due = today)).isEqualTo(ChoreState.NOT_STARTED)
        assertThat(state(due = today.plusDays(1), done = 2)).isEqualTo(ChoreState.READY_TO_FINISH)
    }

    @Test
    fun `the limit is five unfinished chores`() {
        assertThat(ChoreRules.limitReached(4)).isFalse()
        assertThat(ChoreRules.limitReached(5)).isTrue()
    }

    @Test
    fun `unfinished states`() {
        val unfinished = ChoreState.entries.filter { ChoreRules.isUnfinished(it) }
        assertThat(unfinished).containsExactlyInAnyOrder(ChoreState.NOT_STARTED, ChoreState.IN_PROGRESS, ChoreState.READY_TO_FINISH)
    }

    @Test
    fun `closed on and chart day`() {
        val sticker = today.minusDays(3)
        assertThat(ChoreRules.closedOn(ChoreState.EARNED, sticker, null)).isEqualTo(sticker)
        assertThat(ChoreRules.closedOn(ChoreState.MISSED, null, yesterday)).isEqualTo(yesterday)
        assertThat(ChoreRules.closedOn(ChoreState.IN_PROGRESS, null, today)).isNull()
        assertThat(ChoreRules.chartDay(ChoreState.EARNED, sticker, null, today)).isEqualTo(sticker)
        assertThat(ChoreRules.chartDay(ChoreState.MISSED, null, yesterday, today)).isEqualTo(yesterday)
        assertThat(ChoreRules.chartDay(ChoreState.NOT_STARTED, null, null, today)).isEqualTo(today)
    }

    @Test
    fun `missed cutoff is thirty days back`() {
        assertThat(ChoreRules.missedCutoff(today)).isEqualTo(today.minusDays(30))
    }
}
