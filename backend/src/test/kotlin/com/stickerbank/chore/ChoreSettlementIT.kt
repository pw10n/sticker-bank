package com.stickerbank.chore

import com.stickerbank.chart.DaySettlement
import com.stickerbank.common.ChildLock
import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

/** Finishing chores when their due date ends (TDD 7.12 step 5, FR-13.20), driven through DaySettlement with a moving clock. */
@IntegrationTest
class ChoreSettlementIT : FlowTestBase() {
    @Autowired lateinit var childLock: ChildLock

    @Autowired lateinit var settlement: DaySettlement

    private val day = LocalDate.of(2026, 10, 15)
    private var childId = 0L

    @BeforeEach
    fun setUp() {
        childId = fixtures.createChild()
        setWatermark(day.minusDays(1))
    }

    private fun setWatermark(date: LocalDate?, child: Long = childId) {
        jdbc.sql("UPDATE child SET settled_through = ? WHERE id = ?").params(listOf(date, child)).update()
    }

    private fun watermark(): LocalDate? = jdbc.sql("SELECT settled_through FROM child WHERE id = ?").param(childId)
        .query { rs, _ -> rs.getObject("settled_through", LocalDate::class.java) }.list().single()

    private fun settle(child: Long = childId) = childLock.withChildLock(child) { settlement.settleLocked(child) }

    private fun nextMorning() = clock.advance(Duration.ofDays(1))

    private fun fullyChecked(dueDate: LocalDate?, name: String = "Tidy the playroom", child: Long = childId, removed: Boolean = false) =
        fixtures.createChore(child, name = name, dueDate = dueDate, checked = setOf(0, 1), removed = removed).choreId

    private data class StickerRow(
        val id: Long,
        val source: String,
        val routineId: Long?,
        val status: String,
        val finishMode: String?,
        val chartDate: LocalDate,
        val earnedAt: LocalDateTime,
        val name: String?,
        val iconKey: String?,
    )

    private fun stickers(choreId: Long): List<StickerRow> = jdbc.sql(
        "SELECT id, source, routine_id, status, finish_mode, chart_date, earned_at, routine_name, routine_icon_key FROM sticker " +
            "WHERE chore_id = ? ORDER BY id",
    ).param(choreId).query { rs, _ ->
        StickerRow(
            rs.getLong("id"),
            rs.getString("source"),
            (rs.getObject("routine_id") as Number?)?.toLong(),
            rs.getString("status"),
            rs.getString("finish_mode"),
            rs.getObject("chart_date", LocalDate::class.java),
            rs.getObject("earned_at", LocalDateTime::class.java),
            rs.getString("routine_name"),
            rs.getString("routine_icon_key"),
        )
    }.list()

    private fun allStickers(): Long = count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)

    @Test
    fun `a fully checked chore is finished automatically when its due date ends`() {
        val choreId = fullyChecked(day, name = "Feed the fish")
        settle()
        assertThat(stickers(choreId)).isEmpty() // due today: it carries on

        nextMorning()
        settle()

        val rows = stickers(choreId)
        assertThat(rows).hasSize(1)
        val row = rows.single()
        assertThat(row.source).isEqualTo("CHORE")
        assertThat(row.routineId).isNull()
        assertThat(row.status).isEqualTo("UNCLAIMED")
        assertThat(row.finishMode).isEqualTo("AUTO")
        assertThat(row.chartDate).isEqualTo(day)
        assertThat(row.earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 16, 0, 0))
        assertThat(row.name).isEqualTo("Feed the fish")
        assertThat(row.iconKey).isEqualTo("broom")
        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", row.id)).isEqualTo(3)
        assertThat(watermark()).isEqualTo(day)
    }

    @Test
    fun `earned_at is the end of the due date in the family time zone`() {
        fixtures.setPin(timeZone = "America/Los_Angeles")
        clock.set(Instant.parse("2026-10-15T20:00:00Z")) // 13:00 on the 15th in Los Angeles
        val choreId = fullyChecked(day)
        settle()
        assertThat(stickers(choreId)).isEmpty()

        clock.set(Instant.parse("2026-10-16T20:00:00Z")) // 13:00 on the 16th
        settle()

        val row = stickers(choreId).single()
        assertThat(row.chartDate).isEqualTo(day)
        // midnight starting the 16th in Los Angeles (PDT, UTC-7), stored in UTC
        assertThat(row.earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 16, 7, 0))
    }

    @Test
    fun `settling twice changes nothing`() {
        val choreId = fullyChecked(day)
        nextMorning()
        settle()
        settle()
        nextMorning()
        settle()
        assertThat(stickers(choreId)).hasSize(1)
        assertThat(allStickers()).isEqualTo(1)
    }

    @Test
    fun `a partly checked chore earns nothing when its due date ends`() {
        val choreId = fixtures.createChore(childId, dueDate = day, checked = setOf(0)).choreId
        repeat(3) {
            nextMorning()
            settle()
        }
        assertThat(stickers(choreId)).isEmpty()
        assertThat(count("SELECT COUNT(*) FROM chore_task WHERE chore_id = ? AND checked_at IS NOT NULL", choreId)).isEqualTo(1)
    }

    @Test
    fun `a chore with no due date earns nothing however many days pass`() {
        val choreId = fullyChecked(null)
        repeat(4) {
            nextMorning()
            settle()
        }
        assertThat(stickers(choreId)).isEmpty()
        assertThat(watermark()).isEqualTo(day.plusDays(3))
    }

    @Test
    fun `a chore due today or later earns nothing`() {
        nextMorning() // today is the 16th
        val dueToday = fullyChecked(day.plusDays(1), name = "Feed the fish")
        val dueLater = fullyChecked(day.plusDays(5), name = "Water the plants")
        settle()
        assertThat(stickers(dueToday)).isEmpty()
        assertThat(stickers(dueLater)).isEmpty()
    }

    @Test
    fun `a chore with no tasks is never finished`() {
        val choreId = fixtures.createChore(childId, dueDate = day.minusDays(3), tasks = emptyList()).choreId
        nextMorning()
        settle()
        assertThat(stickers(choreId)).isEmpty()
    }

    @Test
    fun `a chore whose due date the watermark already passed is finished by the next settlement`() {
        // As after a time zone change or a pre-V6 pod: the 12th is behind the watermark but was never finished.
        val choreId = fullyChecked(day.minusDays(3))
        settle()
        assertThat(stickers(choreId)).isEmpty() // the watermark is current, so nothing runs today

        nextMorning()
        settle()

        val row = stickers(choreId).single()
        assertThat(row.finishMode).isEqualTo("AUTO")
        assertThat(row.chartDate).isEqualTo(day.minusDays(3))
        assertThat(row.earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 13, 0, 0))
    }

    @Test
    fun `a removed chore is ignored`() {
        val choreId = fullyChecked(day, removed = true)
        nextMorning()
        settle()
        assertThat(stickers(choreId)).isEmpty()
    }

    @Test
    fun `a chore that already has a live sticker is ignored`() {
        val choreId = fullyChecked(day)
        val existing = fixtures.createChoreSticker(childId, choreId, day, StickerStatus.AVAILABLE, fixtures.activeDesignIds().first())
        nextMorning()
        settle()
        assertThat(stickers(choreId).map { it.id }).containsExactly(existing)
    }

    @Test
    fun `a child without a watermark only gets one, and its chores wait for the next day`() {
        setWatermark(null)
        val choreId = fullyChecked(day.minusDays(2))
        settle()
        assertThat(stickers(choreId)).isEmpty()
        assertThat(watermark()).isEqualTo(day.minusDays(1))

        nextMorning()
        settle()
        assertThat(stickers(choreId)).hasSize(1)
    }

    @Test
    fun `settling one child leaves another child's chores alone`() {
        val other = fixtures.createChild(name = "John Doe")
        setWatermark(day.minusDays(1), other)
        val otherChore = fullyChecked(day, child = other)
        val mine = fullyChecked(day)
        nextMorning()
        settle()
        assertThat(stickers(mine)).hasSize(1)
        assertThat(stickers(otherChore)).isEmpty()
    }

    @Test
    fun `routines are still finished automatically in the same run`() {
        val routine = fixtures.createRoutine(childId)
        routine.taskIds.forEach { fixtures.completeTask(childId, routine.routineId, it, day) }
        val choreId = fullyChecked(day)
        nextMorning()
        settle()

        assertThat(stickers(choreId)).hasSize(1)
        assertThat(
            count(
                "SELECT COUNT(*) FROM sticker WHERE routine_id = ? AND chart_date = ? AND finish_mode = 'AUTO' AND source = 'ROUTINE'",
                routine.routineId,
                day,
            ),
        ).isEqualTo(1)
        assertThat(allStickers()).isEqualTo(2)
    }
}
