package com.stickerbank.chart

import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.RoutineFixture
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Ending the day (TDD 7.12, FR-6.10, FR-6.11): a routine still Ready to finish is finished for the child, lazily. */
@IntegrationTest
class DaySettlementIT : FlowTestBase() {
    private val day = LocalDate.of(2026, 10, 15)
    private val nextDay = day.plusDays(1)

    private lateinit var parent: Cookie
    private var childId = 0L
    private lateinit var r: RoutineFixture

    @BeforeEach
    fun setUp() {
        parent = seededParent()
        childId = fixtures.createChild()
        r = fixtures.createRoutine(childId)
    }

    private fun checkEveryTask(routine: RoutineFixture = r, date: String = "today", cookie: Cookie? = null) =
        routine.taskIds.forEach { completeTask(childId, date, it, cookie).andExpect(status().isOk) }

    private fun nextMorning() = clock.advance(Duration.ofDays(1))

    /** A parent session that is valid right now. The one from setUp idles out (5 minutes) once the clock moves a day. */
    private fun freshParent(): Cookie = fixtures.parentCookie(fixtures.createParentSession())

    private data class StickerRow(val status: String, val finishMode: String?, val earnedAt: LocalDateTime, val claimedAt: LocalDateTime?)

    private fun stickerRows(routineId: Long = r.routineId, date: LocalDate = day): List<StickerRow> = jdbc.sql(
        "SELECT status, finish_mode, earned_at, claimed_at FROM sticker WHERE routine_id = ? AND chart_date = ? ORDER BY id",
    ).params(routineId, date).query { rs, _ ->
        StickerRow(
            rs.getString("status"),
            rs.getString("finish_mode"),
            rs.getObject("earned_at", LocalDateTime::class.java),
            rs.getObject("claimed_at", LocalDateTime::class.java),
        )
    }.list()

    private fun watermark(): LocalDate? = jdbc.sql("SELECT settled_through FROM child WHERE id = ?").param(childId)
        .query { rs, _ -> rs.getObject("settled_through", LocalDate::class.java) }.list().single()

    @Test
    fun `a routine left ready to finish is finished automatically when the day ends`() {
        checkEveryTask()
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
        assertThat(stickerRows()).isEmpty()

        nextMorning()
        val chart = read(fetch("/api/children/$childId/days/today").andExpect(status().isOk))

        // the new day starts clean; yesterday's sticker waits unclaimed in the tray (FR-6.10)
        assertThat(text(chart, "$.date")).isEqualTo(nextDay.toString())
        assertThat(text(chart, "$.routines[0].state")).isEqualTo("NOT_STARTED")
        assertThat(longs(chart, "$.unclaimedFromEarlierDays[*].stickerId")).hasSize(1)
        assertThat(text(chart, "$.unclaimedFromEarlierDays[0].chartDate")).isEqualTo(day.toString())

        val rows = stickerRows()
        assertThat(rows).hasSize(1)
        assertThat(rows[0].status).isEqualTo("UNCLAIMED")
        assertThat(rows[0].finishMode).isEqualTo("AUTO")
        // earned_at is the end of the finished day, whenever the settlement ran (I-22)
        assertThat(rows[0].earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 16, 0, 0))
        assertThat(watermark()).isEqualTo(day)
        assertThat(
            count("SELECT COUNT(*) FROM sticker_pick_choice sc JOIN sticker s ON s.id = sc.sticker_id WHERE s.routine_id = ?", r.routineId),
        )
            .isEqualTo(3)
    }

    @Test
    fun `settling is idempotent`() {
        checkEveryTask()
        nextMorning()
        repeat(3) { fetch("/api/children/$childId/days/today").andExpect(status().isOk) }
        assertThat(stickerRows()).hasSize(1)
    }

    @Test
    fun `the child can pick an auto-finished sticker the next time the app opens`() {
        checkEveryTask()
        nextMorning()
        val chart = read(fetch("/api/children/$childId/days/today").andExpect(status().isOk))
        val stickerId = long(chart, "$.unclaimedFromEarlierDays[0].stickerId")
        val pick = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        assertThat(text(pick, "$.status")).isEqualTo("UNCLAIMED")
        val choices = longs(pick, "$.choices[*].designId")
        assertThat(choices).hasSize(3)

        claim(stickerId, choices[0]).andExpect(status().isOk).andExpect(jsonPath("$.status").value("AVAILABLE"))
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))
    }

    @Test
    fun `only the parent is told that the sticker was finished automatically`() {
        checkEveryTask()
        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        val parentNow = freshParent()

        fetch("/api/children/$childId/days/$day", parentNow)
            .andExpect(jsonPath("$.routines[0].state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.routines[0].sticker.autoFinished").value(true))
        fetch("/api/children/$childId/days/$day")
            .andExpect(jsonPath("$.routines[0].state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.routines[0].sticker.autoFinished").doesNotExist())
        fetch("/api/parent/children/$childId/history?from=$day&to=$nextDay", parentNow)
            .andExpect(jsonPath("$.days[0].routines[0].autoFinished").value(true))
            .andExpect(jsonPath("$.days[1].routines[0].autoFinished").value(false))
    }

    @Test
    fun `a sticker the child finished by tapping is not marked as automatic`() {
        checkEveryTask()
        finishRoutine(childId, "today", r.routineId).andExpect(status().isOk)
        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        assertThat(stickerRows().map { it.finishMode }).containsExactly("TAPPED")
        val parentNow = freshParent()
        fetch("/api/children/$childId/days/$day", parentNow).andExpect(jsonPath("$.routines[0].sticker.autoFinished").value(false))
        fetch("/api/parent/children/$childId/history?from=$day&to=$day", parentNow)
            .andExpect(jsonPath("$.days[0].routines[0].autoFinished").value(false))
    }

    @Test
    fun `partly done and skipped routines are not finished at day end`() {
        val partly = fixtures.createRoutine(childId, name = "Evening Routine")
        val skipped = fixtures.createRoutine(childId, name = "Bedtime Routine")
        // the first request of the day sets the watermark, then the day's taps follow
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        completeTask(childId, "today", partly.taskIds[0]).andExpect(status().isOk)
        checkEveryTask(skipped)
        jdbc.sql(
            "INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, NOW())",
        ).params(skipped.routineId, day).update()

        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isZero()
    }

    @Test
    fun `a gap of several days is settled in one pass`() {
        checkEveryTask()
        // nobody opens the app for three days (or the server was down)
        clock.advance(Duration.ofDays(3))
        val chart = read(fetch("/api/children/$childId/days/today").andExpect(status().isOk))
        assertThat(text(chart, "$.date")).isEqualTo("2026-10-18")
        assertThat(stickerRows(date = day)).hasSize(1)
        assertThat(stickerRows(date = day)[0].earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 16, 0, 0))
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isEqualTo(1)
        assertThat(watermark()).isEqualTo(LocalDate.of(2026, 10, 17))
    }

    @Test
    fun `a child with no watermark starts at yesterday and settles nothing`() {
        // data that predates V5: yesterday is fully done but has no sticker. The old rule would have earned it already.
        r.taskIds.forEach { fixtures.completeTask(childId, r.routineId, it, day.minusDays(1)) }
        assertThat(watermark()).isNull()
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isZero()
        assertThat(watermark()).isEqualTo(day.minusDays(1))
    }

    @Test
    fun `a parent's later edit of a settled past day stays ready to finish until the parent taps I'm Done!`() {
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        assertThat(watermark()).isEqualTo(day)

        // FR-6.5: the parent fixes yesterday afterwards
        var parentNow = freshParent()
        checkEveryTask(date = day.toString(), cookie = parentNow)
        fetch("/api/children/$childId/days/$day", parentNow).andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(status().isOk)
        parentNow = freshParent()
        fetch("/api/children/$childId/days/$day", parentNow).andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
        assertThat(stickerRows()).isEmpty()
        fetch("/api/parent/children/$childId/history?from=$day&to=$day", parentNow)
            .andExpect(jsonPath("$.days[0].routines[0].state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.days[0].routines[0].stickerId").doesNotExist())

        finishRoutine(childId, day.toString(), r.routineId, parentNow).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
        assertThat(stickerRows().map { it.finishMode }).containsExactly("TAPPED")
    }

    @Test
    fun `a sticker revoked today is earned again at the end of the day with the same choices`() {
        checkEveryTask()
        val first = read(finishRoutine(childId, "today", r.routineId).andExpect(status().isOk))
        val offered = longs(first, "$.pick.choices[*].designId")
        send("DELETE", "/api/children/$childId/days/today/tasks/${r.taskIds[1]}?revokeSticker=true", null, parent).andExpect(status().isOk)
        completeTask(childId, "today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))

        nextMorning()
        val chart = read(fetch("/api/children/$childId/days/today").andExpect(status().isOk))
        val rows = stickerRows()
        assertThat(rows.map { it.status }).containsExactly("REVOKED", "UNCLAIMED")
        assertThat(rows.map { it.finishMode }).containsExactly("TAPPED", "AUTO")
        val stickerId = long(chart, "$.unclaimedFromEarlierDays[0].stickerId")
        assertThat(longs(read(fetch("/api/stickers/$stickerId/pick")), "$.choices[*].designId")).containsExactlyElementsOf(offered)
        assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?", r.routineId)).isEqualTo(1)
    }

    @Test
    fun `the first request of the new day settles yesterday even when it is a task write`() {
        checkEveryTask()
        nextMorning()
        val other = fixtures.createRoutine(childId, name = "Evening Routine")
        completeTask(childId, "today", other.taskIds[0]).andExpect(status().isOk)
        assertThat(stickerRows()).hasSize(1)
        assertThat(stickerRows()[0].finishMode).isEqualTo("AUTO")
    }

    @Test
    fun `an empty pool falls back to the gold star at day end`() {
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE is_fallback = FALSE").update()
        checkEveryTask()
        nextMorning()
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
        val rows = stickerRows()
        assertThat(rows).hasSize(1)
        assertThat(rows[0].status).isEqualTo("AVAILABLE")
        assertThat(rows[0].finishMode).isEqualTo("AUTO")
        assertThat(rows[0].claimedAt).isEqualTo(rows[0].earnedAt)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))
    }

    @Test
    fun `the end of the day follows the family time zone`() {
        fixtures.setPin("1234", "America/Los_Angeles")
        clock.set(Instant.parse("2026-10-15T20:00:00Z")) // 13:00 on the 15th in Los Angeles
        checkEveryTask()
        clock.set(Instant.parse("2026-10-16T20:00:00Z")) // 13:00 on the 16th
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.date").value("2026-10-16"))
        // midnight in Los Angeles is 07:00 UTC while daylight saving time is on
        assertThat(stickerRows()[0].earnedAt).isEqualTo(LocalDateTime.of(2026, 10, 16, 7, 0))
    }

    @Test
    fun `concurrent first requests after midnight produce exactly one sticker`() {
        checkEveryTask()
        nextMorning()
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(4)
        val results =
            (1..4).map {
                pool.submit<Int> {
                    start.await()
                    fetch("/api/children/$childId/days/today").andReturn().response.status
                }
            }
        start.countDown()
        assertThat(results.map { it.get(30, TimeUnit.SECONDS) }).containsOnly(200)
        pool.shutdown()
        assertThat(stickerRows()).hasSize(1)
    }

    @Test
    fun `a late I'm Done! for yesterday is refused and the child still gets the sticker`() {
        checkEveryTask()
        // the child's tablet still shows yesterday's chart when midnight passes, then the child taps I'm Done!
        nextMorning()
        finishRoutine(childId, day.toString(), r.routineId)
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DAY_CHANGED"))
            .andExpect(jsonPath("$.today").value(nextDay.toString()))
        // the refused tap is not a lost sticker: the app reloads, and settlement has earned it
        fetch("/api/children/$childId/days/today").andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(1))
        assertThat(stickerRows()).hasSize(1)
        assertThat(stickerRows()[0].finishMode).isEqualTo("AUTO")
    }
}
