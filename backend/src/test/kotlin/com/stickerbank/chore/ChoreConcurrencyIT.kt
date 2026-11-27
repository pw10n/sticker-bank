package com.stickerbank.chore

import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.ChoreFixture
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.RepeatedTest
import org.springframework.test.web.servlet.ResultActions
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Chore races (TDD 7.1, 7.13, 13), over HTTP against the real database: each outcome must match one serial order and
 * there is never more than one live sticker per chore (BR-20).
 */
@IntegrationTest
class ChoreConcurrencyIT : FlowTestBase() {
    private lateinit var api: ChoreApi
    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)

    @BeforeEach
    fun setUp() {
        childId = fixtures.createChild("Jane Doe")
        api = ChoreApi(mvc, fixtures)
    }

    @AfterEach
    fun resetClock() {
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
    }

    private fun status(result: ResultActions) = result.andReturn().response.status

    /** Runs every task at the same moment on its own thread and returns the results in order. */
    private fun raceAll(vararg tasks: () -> Any): List<Any> {
        val pool = Executors.newFixedThreadPool(tasks.size)
        try {
            val ready = CountDownLatch(tasks.size)
            val go = CountDownLatch(1)
            val futures = tasks.map { task ->
                pool.submit(
                    Callable {
                        ready.countDown()
                        go.await()
                        task()
                    },
                )
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue()
            go.countDown()
            return futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun fullChore(due: LocalDate? = null): ChoreFixture = fixtures.createChore(childId, dueDate = due, checked = setOf(0, 1))

    private fun live(choreId: Long) = count("SELECT COUNT(*) FROM live_sticker WHERE chore_id = ?", choreId)

    private fun total(choreId: Long) = count("SELECT COUNT(*) FROM sticker WHERE chore_id = ?", choreId)

    private fun choices(body: String) = longs(body, "$.pick.choices[*].designId")

    @RepeatedTest(5)
    fun `two finishes at once give exactly one sticker and the same choices`() {
        val chore = fullChore()
        val results = raceAll(
            { api.finish(childId, chore.choreId).andReturn().response },
            { api.finish(childId, chore.choreId).andReturn().response },
            { api.finish(childId, chore.choreId, asParent = true).andReturn().response },
        ).map { it as org.springframework.mock.web.MockHttpServletResponse }

        assertThat(results.map { it.status }).containsOnly(200)
        val bodies = results.map { it.contentAsString }
        assertThat(bodies.map { long(it, "$.pick.stickerId") }.distinct()).hasSize(1)
        assertThat(bodies.map { choices(it) }.distinct()).hasSize(1)
        assertThat(choices(bodies[0])).hasSize(3)
        assertThat(total(chore.choreId)).isEqualTo(1)
        assertThat(live(chore.choreId)).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", long(bodies[0], "$.pick.stickerId"))).isEqualTo(3)
    }

    @RepeatedTest(5)
    fun `a finish racing a parent's remove ends in one serial order and never a sticker on a removed chore`() {
        val chore = fullChore()
        val (finish, remove) = raceAll(
            { status(api.finish(childId, chore.choreId)) },
            { status(api.remove(chore.choreId)) },
        )
        val removed = count("SELECT COUNT(*) FROM chore WHERE id = ? AND removed_at IS NOT NULL", chore.choreId)
        if (finish == 200) {
            // finish first: the chore has a sticker, so the remove is refused
            assertThat(remove).isEqualTo(409)
            assertThat(removed).isZero()
            assertThat(live(chore.choreId)).isEqualTo(1)
        } else {
            // remove first: the chore is gone, so the finish is a 404 and nothing was earned
            assertThat(remove).isEqualTo(204)
            assertThat(finish).isEqualTo(404)
            assertThat(removed).isEqualTo(1)
            assertThat(total(chore.choreId)).isZero()
        }
        assertThat(count("SELECT COUNT(*) FROM live_sticker s JOIN chore c ON c.id = s.chore_id WHERE c.removed_at IS NOT NULL")).isZero()
    }

    @RepeatedTest(5)
    fun `a finish racing a revoke and refinish never leaves two live stickers and keeps the choices`() {
        val chore = fullChore()
        val first = read(api.finish(childId, chore.choreId))
        val firstSticker = long(first, "$.pick.stickerId")
        val offered = choices(first)

        val (tap, parentSide) = raceAll(
            { status(api.finish(childId, chore.choreId)) },
            {
                // the revoke, then the child checks the task again and taps I'm Done!, as on two devices
                val revoke = status(api.undo(childId, chore.choreId, chore.taskIds[1], asParent = true, query = "?revokeSticker=true"))
                val check = status(api.check(childId, chore.choreId, chore.taskIds[1]))
                val refinish = api.finish(childId, chore.choreId).andReturn().response
                listOf(revoke, check, refinish.status) to refinish.contentAsString
            },
        )

        // the other device's tap is either a no-op on the live sticker, or refused because the task was just unchecked
        // (CHORE_NOT_READY), or it is the finish that earned the new sticker
        assertThat(tap as Int).isIn(200, 409)
        @Suppress("UNCHECKED_CAST")
        val side = parentSide as Pair<List<Int>, String>
        val (statuses, body) = side
        assertThat(statuses).containsExactly(200, 200, 200)
        assertThat(live(chore.choreId)).isEqualTo(1)
        assertThat(total(chore.choreId)).isEqualTo(2)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE id = ? AND status = 'REVOKED'", firstSticker)).isEqualTo(1)
        assertThat(long(body, "$.pick.stickerId")).isNotEqualTo(firstSticker)
        assertThat(choices(body)).containsExactlyElementsOf(offered)
        assertThat(count("SELECT COUNT(*) FROM chore_task WHERE chore_id = ? AND checked_at IS NULL", chore.choreId)).isZero()
    }

    @org.junit.jupiter.api.Test
    fun `a finish after the due date returns the pick of the automatic sticker`() {
        val chore = fullChore(due = today)
        api.chart(childId).andReturn()
        clock.set(Instant.parse("2026-10-16T00:00:30Z"))

        val response = api.finish(childId, chore.choreId).andReturn().response

        assertThat(response.status).isEqualTo(200)
        val auto = jdbc.sql("SELECT id FROM sticker WHERE chore_id = ? AND finish_mode = 'AUTO'").param(chore.choreId)
            .query(Long::class.java).single()
        assertThat(long(response.contentAsString, "$.pick.stickerId")).isEqualTo(auto)
        assertThat(choices(response.contentAsString)).hasSize(3)
        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", auto)).isEqualTo(3)
    }

    @RepeatedTest(5)
    fun `a finish racing the first request after the due date gives exactly one sticker`() {
        val chore = fullChore(due = today)
        // today's first request sets the child's watermark, as it would have on any ordinary day
        api.chart(childId).andReturn()
        clock.set(Instant.parse("2026-10-16T00:00:30Z"))

        val results = raceAll(
            { status(api.finish(childId, chore.choreId)) },
            { status(api.chart(childId)) },
            { status(api.chart(childId, asParent = false)) },
            { status(api.finish(childId, chore.choreId)) },
        )

        // the settlement ran inside whichever request got the lock first, so a finish that lands after the due date
        // ended returns the automatic sticker instead of a CHORE_MISSED (I-29)
        assertThat(results).containsOnly(200)
        assertThat(total(chore.choreId)).isEqualTo(1)
        assertThat(live(chore.choreId)).isEqualTo(1)
        val row = jdbc.sql("SELECT chart_date, finish_mode FROM sticker WHERE chore_id = ?").param(chore.choreId)
            .query { rs, _ -> rs.getObject("chart_date", LocalDate::class.java) to rs.getString("finish_mode") }.single()
        assertThat(row).isEqualTo(today to "AUTO")
    }
}
