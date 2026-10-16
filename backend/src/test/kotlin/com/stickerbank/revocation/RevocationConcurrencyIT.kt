package com.stickerbank.revocation

import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.RepeatedTest
import org.springframework.test.web.servlet.ResultActions
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Revoke races (TDD 7.1, 13): each outcome must match some serial order and never leave two live stickers. */
@IntegrationTest
class RevocationConcurrencyIT : FlowTestBase() {
    private val today = LocalDate.of(2026, 10, 15)

    private fun status(result: ResultActions) = result.andReturn().response.status

    private fun <A, B> race(first: () -> A, second: () -> B): Pair<A, B> {
        val pool = Executors.newFixedThreadPool(2)
        try {
            val ready = CountDownLatch(2)
            val go = CountDownLatch(1)
            val a = pool.submit<A> {
                ready.countDown()
                go.await()
                first()
            }
            val b = pool.submit<B> {
                ready.countDown()
                go.await()
                second()
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue()
            go.countDown()
            return a.get(30, TimeUnit.SECONDS) to b.get(30, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
    }

    private class World(val cookie: Cookie, val childId: Long, val routineId: Long, val taskIds: List<Long>)

    private fun world(): World {
        dbCleaner.reset()
        val cookie = seededParent()
        val childId = fixtures.createChild()
        val r = fixtures.createRoutine(childId)
        return World(cookie, childId, r.routineId, r.taskIds)
    }

    /** Checks every task and taps I'm Done! as the child, which is the only way to earn the sticker (FR-6.8). */
    private fun World.earn(): Long {
        completeTask(childId, "today", taskIds[0]).andReturn()
        completeTask(childId, "today", taskIds[1]).andReturn()
        return long(read(finishRoutine(childId, "today", routineId)), "$.pick.stickerId")
    }

    private fun World.revoke() = send("DELETE", "/api/children/$childId/days/today/tasks/${taskIds[1]}?revokeSticker=true", null, cookie)

    private fun World.assertAtMostOneLive() {
        val live = count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ? AND chart_date = ?", routineId, today)
        assertThat(live).isLessThanOrEqualTo(1)
    }

    @RepeatedTest(5)
    fun `revoke versus claiming the pick`() {
        val w = world()
        val stickerId = w.earn()
        val designId = long(read(fetch("/api/stickers/$stickerId/pick")), "$.choices[0].designId")
        val (revoke, claim) = race({ status(w.revoke()) }, { status(claim(stickerId, designId)) })

        assertThat(revoke).isEqualTo(200)
        assertThat(claim).isLessThan(500)
        assertThat(jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(stickerId).query(String::class.java).single())
            .isEqualTo("REVOKED")
        val from = jdbc.sql("SELECT from_status FROM sticker_revocation WHERE sticker_id = ?").param(stickerId)
            .query(String::class.java).single()
        // revoke first -> the claim is rejected; claim first -> the revoke sees AVAILABLE
        assertThat(from).isEqualTo(if (claim in 200..299) "AVAILABLE" else "UNCLAIMED")
        // the offered set stays on the revoked row whichever side won, so a re-earn can offer it again (FR-12.5)
        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", stickerId)).isEqualTo(3)
        w.assertAtMostOneLive()
        assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?", w.routineId)).isZero()
    }

    @RepeatedTest(5)
    fun `revoke versus the parent completing the request`() {
        val w = world()
        val stickerId = w.earn()
        val designId = long(read(fetch("/api/stickers/$stickerId/pick")), "$.choices[0].designId")
        claim(stickerId, designId).andReturn()
        val requestId = long(
            read(send("POST", "/api/children/${w.childId}/prize-requests", """{"stickerIds":[$stickerId]}""", w.cookie)),
            "$.id",
        )
        val (revoke, complete) = race(
            { status(w.revoke()) },
            { status(send("POST", "/api/parent/prize-requests/$requestId/complete", """{"prizeText":"Ice cream"}""", w.cookie)) },
        )

        val stickerStatus = jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(stickerId).query(String::class.java).single()
        val requestStatus = jdbc.sql("SELECT status FROM prize_request WHERE id = ?").param(requestId).query(String::class.java).single()
        if (revoke == 200) {
            // revoke first: the request was cancelled, so completing it fails; or complete ran first and revoke would have failed
            assertThat(stickerStatus).isEqualTo("REVOKED")
            assertThat(requestStatus).isEqualTo("CANCELLED")
            assertThat(complete).isBetween(400, 499)
        } else {
            // complete first: the sticker is USED and the revoke is refused
            assertThat(revoke).isEqualTo(409)
            assertThat(complete).isEqualTo(200)
            assertThat(stickerStatus).isEqualTo("USED")
            assertThat(requestStatus).isEqualTo("COMPLETED")
        }
        w.assertAtMostOneLive()
    }

    @RepeatedTest(5)
    fun `revoke versus the child finishing the routine again`() {
        val w = world()
        val first = w.earn()
        // the child's side is two requests in a row: tap the task again, then tap I'm Done!
        val (revoke, tap) = race(
            { status(w.revoke()) },
            {
                val checked = status(completeTask(w.childId, "today", w.taskIds[1]))
                checked to status(finishRoutine(w.childId, "today", w.routineId))
            },
        )

        assertThat(revoke).isEqualTo(200)
        assertThat(tap.first).isEqualTo(200)
        // I'm Done! is refused (409 ROUTINE_NOT_READY) when the revoke unchecked the task after the tap was a no-op
        assertThat(tap.second).isIn(200, 409)
        w.assertAtMostOneLive()
        val total = count("SELECT COUNT(*) FROM sticker WHERE routine_id = ?", w.routineId)
        val live = count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?", w.routineId)
        val completions = count("SELECT COUNT(*) FROM task_completion WHERE routine_id = ?", w.routineId)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE id = ? AND status = 'REVOKED'", first)).isEqualTo(1)
        if (live == 0L) {
            // the tap was a no-op on the locked routine and the revoke came before I'm Done!, or after it
            assertThat(total).isEqualTo(1)
            assertThat(completions).isEqualTo(1)
        } else {
            // revoke first, then the tap and I'm Done! earned a new sticker
            assertThat(total).isEqualTo(2)
            assertThat(completions).isEqualTo(2)
        }
    }
}
