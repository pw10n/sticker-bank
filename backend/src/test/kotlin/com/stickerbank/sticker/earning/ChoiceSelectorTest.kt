package com.stickerbank.sticker.earning

import com.stickerbank.common.StickerStatus
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.util.Random

class ChoiceSelectorTest {
    private fun rng(seed: Long) = Random(seed)

    @Test
    fun `pool sizes 0 to 3 return everything`() {
        for (n in 0..3) {
            val pool = (1..n).map { it.toLong() }
            assertThat(ChoiceSelector.select(pool, rng(1))).containsExactlyInAnyOrderElementsOf(pool)
        }
    }

    @Test
    fun `large pool yields three distinct members`() {
        val pool = (1L..24L).toList()
        repeat(50) { seed ->
            val picks = ChoiceSelector.select(pool.shuffled(rng(seed.toLong())), rng(seed.toLong()))
            assertThat(picks).hasSize(3).doesNotHaveDuplicates()
            assertThat(pool).containsAll(picks)
        }
    }

    @Test
    fun `same seed gives same picks regardless of input order`() {
        val pool = (1L..24L).toList()
        assertThat(ChoiceSelector.select(pool.reversed(), rng(7))).isEqualTo(ChoiceSelector.select(pool, rng(7)))
    }

    @Test
    fun `cursor round trips and rejects garbage`() {
        val cursor = BookCursor(java.time.LocalDate.parse("2026-10-15"), java.time.LocalDateTime.parse("2026-10-15T15:00:00.123"), 42)
        assertThat(BookCursor.decode(cursor.encode())).isEqualTo(cursor)
        assertThat(BookCursor.decode("!!!")).isNull()
        assertThat(BookCursor.decode("YWJj")).isNull()
    }

    @Test
    fun `counts are assembled with total excluding unclaimed`() {
        val counts = StickerBookService.assembleCounts(
            mapOf(StickerStatus.AVAILABLE to 3, StickerStatus.PENDING to 2, StickerStatus.USED to 1, StickerStatus.UNCLAIMED to 4),
        )
        assertThat(counts.totalEarned).isEqualTo(6)
        assertThat(counts.unclaimed).isEqualTo(4)
        assertThat(StickerBookService.assembleCounts(emptyMap()).totalEarned).isZero()
    }
}
