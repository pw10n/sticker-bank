package com.stickerbank.revocation

import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.RoutineFixture
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

/** Sticker revocation (TDD 7.11) and every live-sticker read in the chart and routine packages (TDD 6.5). */
@IntegrationTest
class RevocationIT : FlowTestBase() {
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    private lateinit var cookie: Cookie
    private var childId = 0L
    private lateinit var r: RoutineFixture

    @BeforeEach
    fun setUp() {
        cookie = seededParent()
        childId = fixtures.createChild()
        r = fixtures.createRoutine(childId)
    }

    /** Completes every task of [routine] on [date] and inserts a sticker in [status]. */
    private fun seedSticker(date: LocalDate, status: StickerStatus, routine: RoutineFixture = r, requestId: Long? = null): Long {
        routine.taskIds.forEach { fixtures.completeTask(childId, routine.routineId, it, date) }
        val designs = fixtures.activeDesignIds()
        val designId = if (status == StickerStatus.UNCLAIMED) null else designs.first()
        val id = fixtures.createSticker(childId, routine.routineId, date, status, designId, requestId)
        if (status == StickerStatus.UNCLAIMED) {
            designs.take(3).forEachIndexed { i, d ->
                jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)").params(id, i + 1, d).update()
            }
        }
        return id
    }

    private fun taskPath(date: Any, taskId: Long, flag: Boolean = true) =
        "/api/children/$childId/days/$date/tasks/$taskId" + if (flag) "?revokeSticker=true" else ""

    private fun revoke(date: Any, taskId: Long, note: String? = null, withCookie: Cookie? = cookie, flag: Boolean = true): ResultActions =
        send("DELETE", taskPath(date, taskId, flag), note?.let { """{"note":"$it"}""" }, withCookie)

    private fun chart(date: String = "today", withCookie: Cookie? = cookie) = fetch("/api/children/$childId/days/$date", withCookie)

    private fun stickerStatus(id: Long) = jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(id).query(String::class.java).single()

    private fun liveCount(routineId: Long = r.routineId, date: LocalDate = today) =
        count("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ? AND chart_date = ?", routineId, date)

    private fun createRequest(vararg ids: Long) = long(
        read(
            send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[${ids.joinToString(",")}]}""", cookie)
                .andExpect(status().isCreated),
        ),
        "$.id",
    )

    @Test
    fun `revoking an unclaimed sticker of a past day deletes its choices and drops it from the tray`() {
        val id = seedSticker(yesterday, StickerStatus.UNCLAIMED)
        chart().andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(1))

        revoke(yesterday, r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.stickerId").value(id))
            .andExpect(jsonPath("$.revoked.fromStatus").value("UNCLAIMED"))
            .andExpect(jsonPath("$.revoked.requestCancelled").value(false))
            .andExpect(jsonPath("$.routine.state").value("MISSED"))
            .andExpect(jsonPath("$.routine.doneCount").value(1))
            .andExpect(jsonPath("$.routine.sticker").doesNotExist())
            .andExpect(jsonPath("$.pick").doesNotExist())

        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", id)).isZero()
        assertThat(stickerStatus(id)).isEqualTo("REVOKED")
        assertThat(count("SELECT COUNT(*) FROM task_completion WHERE routine_id = ?", r.routineId)).isEqualTo(1)
        chart().andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
    }

    @Test
    fun `revoking an available sticker removes it from the book and leaves the routine in progress`() {
        val id = seedSticker(today, StickerStatus.AVAILABLE)
        fetch("/api/children/$childId/stickers?status=AVAILABLE").andExpect(jsonPath("$.items.length()").value(1))

        revoke("today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.fromStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routine.doneCount").value(1))
            .andExpect(jsonPath("$.routine.taskCount").value(2))
            .andExpect(jsonPath("$.routine.tasks[0].done").value(true))
            .andExpect(jsonPath("$.routine.tasks[1].done").value(false))

        assertThat(stickerStatus(id)).isEqualTo("REVOKED")
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.items.length()").value(0))
            .andExpect(jsonPath("$.counts.available").value(0))
            .andExpect(jsonPath("$.counts.totalEarned").value(0))
        chart().andExpect(jsonPath("$.routines[0].state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
    }

    @Test
    fun `revoking one of several pending stickers keeps the request pending`() {
        val second = fixtures.createRoutine(childId, name = "Evening Routine")
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        val b = seedSticker(today, StickerStatus.AVAILABLE, second)
        val requestId = createRequest(a, b)
        fetch("/api/children/$childId/prize-requests/pending", cookie).andExpect(jsonPath("$.request.stickerCount").value(2))

        revoke("today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.fromStatus").value("PENDING"))
            .andExpect(jsonPath("$.revoked.prizeRequestId").value(requestId))
            .andExpect(jsonPath("$.revoked.requestCancelled").value(false))

        assertThat(stickerStatus(a)).isEqualTo("REVOKED")
        assertThat(stickerStatus(b)).isEqualTo("PENDING")
        assertThat(count("SELECT COUNT(*) FROM prize_request WHERE id = ? AND status = 'PENDING'", requestId)).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM prize_request_item WHERE prize_request_id = ?", requestId)).isEqualTo(2)
        fetch("/api/children/$childId/prize-requests/pending", cookie).andExpect(jsonPath("$.request.stickerCount").value(1))
    }

    @Test
    fun `revoking the last pending sticker cancels the request`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        val requestId = createRequest(a)
        fetch("/api/bootstrap").andExpect(jsonPath("$.pendingPrizeRequestCount").value(1))

        revoke("today", r.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.fromStatus").value("PENDING"))
            .andExpect(jsonPath("$.revoked.requestCancelled").value(true))

        fetch("/api/parent/prize-requests?status=CANCELLED", cookie)
            .andExpect(jsonPath("$.items[0].id").value(requestId))
            .andExpect(jsonPath("$.items[0].status").value("CANCELLED"))
            .andExpect(jsonPath("$.items[0].cancelReason").value("ALL_STICKERS_REVOKED"))
            .andExpect(jsonPath("$.items[0].cancelledBy").value("PARENT"))
        assertThat(count("SELECT COUNT(*) FROM prize_request_item WHERE prize_request_id = ?", requestId)).isEqualTo(1)
        fetch("/api/bootstrap").andExpect(jsonPath("$.pendingPrizeRequestCount").value(0))
        fetch("/api/children/$childId/prize-requests/pending", cookie).andExpect(jsonPath("$.request").doesNotExist())
    }

    @Test
    fun `a used sticker cannot be revoked and nothing changes`() {
        val id = seedSticker(today, StickerStatus.USED)
        revoke("today", r.taskIds[1]).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("STICKER_USED"))
        assertThat(stickerStatus(id)).isEqualTo("USED")
        assertThat(count("SELECT COUNT(*) FROM task_completion WHERE routine_id = ?", r.routineId)).isEqualTo(2)
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation")).isZero()
    }

    @Test
    fun `re-earning after a revoke creates a new sticker with new saved choices`() {
        val first = seedSticker(today, StickerStatus.AVAILABLE)
        revoke("today", r.taskIds[1]).andExpect(status().isOk)

        // the last task only makes the routine Ready to finish. I'm Done! earns the new sticker (FR-12.5).
        completeTask(childId, "today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        val body = read(
            finishRoutine(childId, "today", r.routineId).andExpect(status().isOk)
                .andExpect(jsonPath("$.routine.state").value("AWAITING_PICK"))
                .andExpect(jsonPath("$.pick.choices.length()").value(3)),
        )
        val second = long(body, "$.pick.stickerId")

        assertThat(second).isNotEqualTo(first)
        assertThat(stickerStatus(first)).isEqualTo("REVOKED")
        assertThat(stickerStatus(second)).isEqualTo("UNCLAIMED")
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE routine_id = ?", r.routineId)).isEqualTo(2)
        assertThat(liveCount()).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?", second)).isEqualTo(3)
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation WHERE sticker_id = ?", first)).isEqualTo(1)
    }

    @Test
    fun `parent undo without the flag asks for confirmation and changes nothing`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        revoke("today", r.taskIds[1], flag = false).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("REVOKE_CONFIRMATION_REQUIRED"))
            .andExpect(jsonPath("$.sticker.stickerId").value(a))
            .andExpect(jsonPath("$.sticker.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.sticker.revocable").value(true))
        assertThat(stickerStatus(a)).isEqualTo("AVAILABLE")
        assertThat(count("SELECT COUNT(*) FROM task_completion WHERE routine_id = ?", r.routineId)).isEqualTo(2)
    }

    @Test
    fun `confirmation body carries the prize request id of a pending sticker`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        val requestId = createRequest(a)
        revoke("today", r.taskIds[1], flag = false).andExpect(status().isConflict)
            .andExpect(jsonPath("$.sticker.status").value("PENDING"))
            .andExpect(jsonPath("$.sticker.prizeRequestId").value(requestId))
            .andExpect(jsonPath("$.sticker.revocable").value(true))
    }

    @Test
    fun `a child cannot revoke`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        revoke("today", r.taskIds[1], withCookie = null).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
        assertThat(stickerStatus(a)).isEqualTo("AVAILABLE")
    }

    @Test
    fun `a double revoke is idempotent and logs exactly one revocation`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        revoke("today", r.taskIds[1]).andExpect(status().isOk).andExpect(jsonPath("$.revoked.stickerId").value(a))
        revoke("today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked").doesNotExist())
            .andExpect(jsonPath("$.routine.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routine.doneCount").value(1))
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation")).isEqualTo(1)
    }

    @Test
    fun `the note is stored and shown in history`() {
        val a = seedSticker(yesterday, StickerStatus.AVAILABLE)
        revoke(yesterday, r.taskIds[1], note = "Tapped by mistake").andExpect(status().isOk)
        assertThat(jdbc.sql("SELECT note FROM sticker_revocation WHERE sticker_id = ?").param(a).query(String::class.java).single())
            .isEqualTo("Tapped by mistake")

        fetch("/api/parent/children/$childId/history?from=$yesterday&to=$today", cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.days[0].date").value(yesterday.toString()))
            .andExpect(jsonPath("$.days[0].routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.days[0].routines[0].stickerId").doesNotExist())
            .andExpect(jsonPath("$.days[0].revocations.length()").value(1))
            .andExpect(jsonPath("$.days[0].revocations[0].stickerId").value(a))
            .andExpect(jsonPath("$.days[0].revocations[0].note").value("Tapped by mistake"))
            .andExpect(jsonPath("$.days[0].revocations[0].taskLabel").value("Get dressed"))
            .andExpect(jsonPath("$.days[0].revocations[0].fromStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$.days[0].revocations[0].routineName").value("Morning Routine"))
            .andExpect(jsonPath("$.days[0].revocations[0].design.designId").isNumber)
            .andExpect(jsonPath("$.days[1].revocations.length()").value(0))
    }

    @Test
    fun `a single task routine goes back to not started today`() {
        val single = fixtures.createRoutine(childId, name = "Bedtime", tasks = listOf("Read book" to "book"))
        seedSticker(today, StickerStatus.AVAILABLE, single)
        revoke("today", single.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("NOT_STARTED"))
            .andExpect(jsonPath("$.routine.doneCount").value(0))
    }

    @Test
    fun `an unchecked task on a revoked past day is an ordinary undo`() {
        seedSticker(yesterday, StickerStatus.AVAILABLE)
        revoke(yesterday, r.taskIds[1]).andExpect(status().isOk).andExpect(jsonPath("$.revoked").exists())
        // I-18: there is no live sticker any more, so more unchecking needs no flag and logs nothing
        revoke(yesterday, r.taskIds[0], flag = false).andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked").doesNotExist())
            .andExpect(jsonPath("$.routine.state").value("MISSED"))
            .andExpect(jsonPath("$.routine.doneCount").value(0))
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation")).isEqualTo(1)
    }

    @Test
    fun `a task outside the revision or without a completion changes nothing`() {
        val a = seedSticker(today, StickerStatus.AVAILABLE)
        val other = fixtures.createRoutine(childId, name = "Other")
        revoke("today", other.taskIds[0]).andExpect(status().isOk).andExpect(jsonPath("$.revoked").doesNotExist())
        assertThat(stickerStatus(a)).isEqualTo("AVAILABLE")
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation")).isZero()
    }

    @Test
    fun `future dates are rejected`() {
        revoke("2026-10-16", r.taskIds[0]).andExpect(status().isUnprocessableEntity)
    }

    // ---- live reads with a REVOKED row present (TDD 6.5, 13) ----

    private fun seedRevokedRow(date: LocalDate = today, routine: RoutineFixture = r): Long =
        fixtures.createSticker(childId, routine.routineId, date, StickerStatus.REVOKED, fixtures.activeDesignIds().first())

    @Test
    fun `the chart ignores a revoked row for state sticker and tray`() {
        seedRevokedRow(today)
        seedRevokedRow(yesterday)
        fixtures.completeTask(childId, r.routineId, r.taskIds[0], today)
        chart().andExpect(jsonPath("$.routines[0].state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
            .andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
        chart(yesterday.toString()).andExpect(jsonPath("$.routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.routines[0].sticker").doesNotExist())
    }

    @Test
    fun `a revoked unclaimed-looking row never shows in the tray`() {
        val id = seedSticker(yesterday, StickerStatus.UNCLAIMED)
        jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(id).update()
        chart().andExpect(jsonPath("$.unclaimedFromEarlierDays.length()").value(0))
    }

    @Test
    fun `completing is not blocked by a revoked row`() {
        val old = seedRevokedRow(today)
        completeTask(childId, "today", r.taskIds[0]).andExpect(status().isOk)
        completeTask(childId, "today", r.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.routine.state").value("READY_TO_FINISH"))
        finishRoutine(childId, "today", r.routineId).andExpect(status().isOk).andExpect(jsonPath("$.pick.stickerId").isNumber)
        assertThat(liveCount()).isEqualTo(1)
        assertThat(stickerStatus(old)).isEqualTo("REVOKED")
    }

    @Test
    fun `history derives states from live stickers only`() {
        seedRevokedRow(yesterday)
        fixtures.completeTask(childId, r.routineId, r.taskIds[0], yesterday)
        fetch("/api/parent/children/$childId/history?from=$yesterday&to=$yesterday", cookie)
            .andExpect(jsonPath("$.days[0].routines[0].state").value("MISSED"))
            .andExpect(jsonPath("$.days[0].routines[0].stickerId").doesNotExist())
    }

    private fun routineBody(label: String = "Brush teeth"): String =
        """{"name":"Morning Routine","iconKey":"sun","color":null,"days":null,"paused":false,
            "tasks":[{"id":${r.taskIds[0]},"label":"$label","iconKey":"toothbrush"},
                     {"id":${r.taskIds[1]},"label":"Get dressed","iconKey":"t-shirt"}]}"""

    @Test
    fun `edits apply today again after a revoke and tomorrow while the sticker exists`() {
        seedSticker(today, StickerStatus.AVAILABLE)
        send("PUT", "/api/parent/routines/${r.routineId}", routineBody("Brush all teeth"), cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.appliesFromTomorrow").value(true))

        revoke("today", r.taskIds[1]).andExpect(status().isOk)
        send("PUT", "/api/parent/routines/${r.routineId}", routineBody("Brush teeth well"), cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.appliesFromTomorrow").value(false))
            .andExpect(jsonPath("$.effectiveFrom").value(today.toString()))
    }

    @Test
    fun `an edit that leaves every task done after a revoke makes the routine ready to finish and earns nothing`() {
        seedRevokedRow(today)
        fixtures.completeTask(childId, r.routineId, r.taskIds[0], today)
        val body = """{"name":"Morning Routine","iconKey":"sun","color":null,"days":null,"paused":false,
            "tasks":[{"id":${r.taskIds[0]},"label":"Brush teeth","iconKey":"toothbrush"}]}"""
        send("PUT", "/api/parent/routines/${r.routineId}", body, cookie).andExpect(status().isOk)
            .andExpect(jsonPath("$.earnedPick").doesNotExist())
        assertThat(liveCount()).isZero()
        chart().andExpect(jsonPath("$.routines[0].state").value("READY_TO_FINISH"))
        finishRoutine(childId, "today", r.routineId).andExpect(status().isOk)
        assertThat(liveCount()).isEqualTo(1)
    }

    @Test
    fun `skip is allowed after a revoke but not while the sticker is live`() {
        seedSticker(today, StickerStatus.AVAILABLE)
        send("PUT", "/api/parent/routines/${r.routineId}/skips/$today", null, cookie).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("ROUTINE_LOCKED"))
        revoke("today", r.taskIds[1]).andExpect(status().isOk)
        send("PUT", "/api/parent/routines/${r.routineId}/skips/$today", null, cookie).andExpect(status().isNoContent)
        chart().andExpect(jsonPath("$.routines[0].state").value("SKIPPED"))
    }

    @Test
    fun `skip of a day with only a revoked row is allowed`() {
        seedRevokedRow(yesterday)
        send("PUT", "/api/parent/routines/${r.routineId}/skips/$yesterday", null, cookie).andExpect(status().isNoContent)
    }
}
