package com.stickerbank.flows

import com.stickerbank.chore.ChoreApi
import com.stickerbank.chore.TaskBody
import com.stickerbank.common.StickerStatus
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Full chore flows over HTTP, against the real database and the real beans (TDD 7.13, 13): the life of a chore, carry-over,
 * the due date, the revoke round trip, already done, the limit, access and the lists.
 */
@IntegrationTest
class ChoreFlowIT : FlowTestBase() {
    private lateinit var api: ChoreApi
    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)

    private class Chore(val id: Long, val tasks: List<Long>, val name: String)

    @BeforeEach
    fun setUp() {
        childId = fixtures.createChild("Jane Doe")
        api = ChoreApi(mvc, fixtures)
    }

    @AfterEach
    fun resetClock() {
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
    }

    private fun assign(
        child: Long = childId,
        name: String = "Tidy up",
        due: LocalDate? = null,
        tasks: List<TaskBody> = listOf(TaskBody("Blocks away"), TaskBody("Books away", "open-book")),
        alreadyDone: Boolean? = null,
    ): Chore {
        val saved =
            read(
                api.assign(child, api.body(name = name, due = due, tasks = tasks, alreadyDone = alreadyDone)).andExpect(status().isCreated),
            )
        return Chore(long(saved, "$.choreId"), longs(saved, "$.tasks[*].taskId"), name)
    }

    private fun check(chore: Chore, index: Int, child: Long = childId): ResultActions = api.check(child, chore.id, chore.tasks[index])

    private fun checkAll(chore: Chore, child: Long = childId) {
        chore.tasks.indices.forEach { check(chore, it, child).andExpect(status().isOk) }
    }

    /** Checks every task and taps I'm Done!; returns the body of the finish response. */
    private fun finish(chore: Chore, child: Long = childId): String {
        checkAll(chore, child)
        return read(api.finish(child, chore.id).andExpect(status().isOk))
    }

    /** Finishes the chore and claims the first choice; returns the sticker id. */
    private fun earnAndClaim(chore: Chore, child: Long = childId): Long {
        val body = finish(chore, child)
        val stickerId = long(body, "$.pick.stickerId")
        claim(stickerId, long(body, "$.pick.choices[0].designId")).andExpect(status().isOk)
        return stickerId
    }

    private fun stickerRows(choreId: Long) = count("SELECT COUNT(*) FROM sticker WHERE chore_id = ?", choreId)

    private fun liveRows(choreId: Long) = count("SELECT COUNT(*) FROM live_sticker WHERE chore_id = ?", choreId)

    private fun chartChores(child: Long = childId, date: String = "today"): String = read(api.chart(child, date).andExpect(status().isOk))

    private fun choreIdsOnChart(child: Long = childId, date: String = "today"): List<Long> =
        longs(chartChores(child, date), "$.chores[*].choreId")

    private fun listIds(query: String): List<Long> = longs(read(api.list(query).andExpect(status().isOk)), "$.items[*].choreId")

    /** Moves the clock and keeps the parent session alive across the jump (it expires after 12 hours). */
    private fun at(instant: String) {
        clock.set(Instant.parse(instant))
        val now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)
        jdbc.sql("UPDATE parent_session SET last_seen_at = ?, expires_at = ?").params(now, now.plusHours(12)).update()
    }

    // ---- the life of a chore

    @Test
    fun `a chore goes from assigned to checked to finished to claimed and is in the Sticker Book`() {
        val chore =
            assign(name = "Tidy the playroom", tasks = listOf(TaskBody("Blocks away"), TaskBody("Books away"), TaskBody("Floor clear")))
        assertThat(choreIdsOnChart()).containsExactly(chore.id)
        api.chart(childId).andExpect(jsonPath("$.chores[0].state").value("NOT_STARTED"))
            .andExpect(jsonPath("$.chores[0].taskCount").value(3))
            .andExpect(jsonPath("$.routines.length()").value(0))

        check(chore, 0).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.chore.doneCount").value(1))
        check(chore, 1).andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
        check(chore, 2).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(stickerRows(chore.id)).isZero()

        val first = read(api.finish(childId, chore.id).andExpect(status().isOk))
        assertThat(text(first, "$.chore.state")).isEqualTo("AWAITING_PICK")
        val choices = longs(first, "$.pick.choices[*].designId")
        assertThat(choices).hasSize(3).doesNotHaveDuplicates()
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isEqualTo(1)

        val second = read(api.finish(childId, chore.id).andExpect(status().isOk))
        assertThat(long(second, "$.pick.stickerId")).isEqualTo(long(first, "$.pick.stickerId"))
        assertThat(longs(second, "$.pick.choices[*].designId")).containsExactlyElementsOf(choices)
        assertThat(stickerRows(chore.id)).isEqualTo(1)

        val stickerId = long(first, "$.pick.stickerId")
        claim(stickerId, choices[1]).andExpect(status().isOk)
        fetch("/api/children/$childId/stickers")
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].stickerId").value(stickerId))
            .andExpect(jsonPath("$.items[0].source").value("CHORE"))
            .andExpect(jsonPath("$.items[0].routineName").value("Tidy the playroom"))
            .andExpect(jsonPath("$.items[0].design.designId").value(choices[1]))
            .andExpect(jsonPath("$.counts.available").value(1))

        api.chart(childId).andExpect(jsonPath("$.chores.length()").value(1))
            .andExpect(jsonPath("$.chores[0].state").value("EARNED"))
        assertThat(listIds("filter=active")).isEmpty()
        assertThat(listIds("filter=closed")).containsExactly(chore.id)
        // a finished chore finishes again as a no-op, with no pick
        api.finish(childId, chore.id).andExpect(status().isOk).andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(stickerRows(chore.id)).isEqualTo(1)
    }

    // ---- carry-over

    @Test
    fun `an unfinished chore with no due date carries over several midnights with its checks and earns nothing`() {
        val chore = assign()
        check(chore, 0).andExpect(status().isOk)
        listOf("2026-10-16T09:00:00Z", "2026-10-17T00:00:05Z", "2026-10-20T23:59:00Z").forEach {
            at(it)
            val body = chartChores()
            assertThat(longs(body, "$.chores[*].choreId")).containsExactly(chore.id)
            assertThat(text(body, "$.chores[0].state")).isEqualTo("IN_PROGRESS")
            assertThat(long(body, "$.chores[0].doneCount")).isEqualTo(1)
        }
        assertThat(stickerRows(chore.id)).isZero()
        assertThat(listIds("filter=active")).containsExactly(chore.id)
        // and it can still be finished days later
        check(chore, 1).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("READY_TO_FINISH"))
        api.finish(childId, chore.id).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("AWAITING_PICK"))
        // a fully checked chore with no due date is never finished by the day ending either
        val full = assign(name = "Fully checked")
        checkAll(full)
        at("2026-10-24T09:00:00Z")
        assertThat(stickerRows(full.id)).isZero()
        assertThat(choreIdsOnChart()).containsExactly(full.id)
    }

    // ---- due date

    @Test
    fun `a partly checked chore is missed after its due date and a fully checked one is finished automatically`() {
        val partly = assign(name = "Partly done", due = today)
        val full = assign(name = "Fully done", due = today)
        check(partly, 0).andExpect(status().isOk)
        checkAll(full)

        at("2026-10-16T08:00:00Z")
        // the first request of the new day settles: the child's chart no longer has either chore
        assertThat(choreIdsOnChart()).isEmpty()
        val tray = read(api.chart(childId).andExpect(status().isOk))
        assertThat(longs(tray, "$.unclaimedFromEarlierDays[*].stickerId")).hasSize(1)
        assertThat(text(tray, "$.unclaimedFromEarlierDays[0].routineName")).isEqualTo("Fully done")
        assertThat(text(tray, "$.unclaimedFromEarlierDays[0].chartDate")).isEqualTo(today.toString())

        assertThat(stickerRows(partly.id)).isZero()
        val auto = jdbc.sql("SELECT chart_date, finish_mode, status FROM sticker WHERE chore_id = ?").param(full.id)
            .query { rs, _ ->
                Triple(rs.getObject("chart_date", LocalDate::class.java), rs.getString("finish_mode"), rs.getString("status"))
            }
            .single()
        assertThat(auto).isEqualTo(Triple(today, "AUTO", "UNCLAIMED"))

        // listed on its due date
        val onDueDate = chartChores(date = today.toString())
        assertThat(longs(onDueDate, "$.chores[*].choreId")).containsExactly(partly.id, full.id)
        assertThat(text(onDueDate, "$.chores[0].state")).isEqualTo("MISSED")
        assertThat(text(onDueDate, "$.chores[1].state")).isEqualTo("AWAITING_PICK")
        // and in the closed list, not in the active one
        assertThat(listIds("filter=closed")).containsExactlyInAnyOrder(partly.id, full.id)
        assertThat(listIds("filter=active")).isEmpty()
        api.check(childId, partly.id, partly.tasks[1]).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_MISSED"))
        api.finish(childId, partly.id).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_MISSED"))

        // the child can claim the automatic sticker from the tray
        val stickerId = long(tray, "$.unclaimedFromEarlierDays[0].stickerId")
        val pick = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        claim(stickerId, long(pick, "$.choices[0].designId")).andExpect(status().isOk)
    }

    @Test
    fun `reopening a missed chore puts it back with its checks and checking works again`() {
        val chore = assign(due = today)
        check(chore, 0).andExpect(status().isOk)
        at("2026-10-16T08:00:00Z")
        assertThat(choreIdsOnChart()).isEmpty()

        val reopened = api.save(
            chore.id,
            api.body(
                due = null,
                tasks = listOf(TaskBody("Blocks away", id = chore.tasks[0]), TaskBody("Books away", "open-book", id = chore.tasks[1])),
            ),
        ).andExpect(status().isOk).andExpect(jsonPath("$.state").value("IN_PROGRESS")).andExpect(jsonPath("$.doneCount").value(1))
        assertThat(longs(read(reopened), "$.tasks[*].taskId")).containsExactlyElementsOf(chore.tasks)

        assertThat(choreIdsOnChart()).containsExactly(chore.id)
        assertThat(listIds("filter=active")).containsExactly(chore.id)
        check(chore, 1).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("READY_TO_FINISH"))
        api.finish(childId, chore.id).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("AWAITING_PICK"))
    }

    // ---- revoke

    @Test
    fun `a parent revokes a finished chore through the endpoint and the child finishes it again with the same choices`() {
        val chore = assign(name = "Feed the fish")
        val first = finish(chore)
        val stickerId = long(first, "$.pick.stickerId")
        val choices = longs(first, "$.pick.choices[*].designId")
        claim(stickerId, choices[0]).andExpect(status().isOk)
        val path = "/api/children/$childId/chores/${chore.id}/tasks/${chore.tasks[1]}"

        api.undo(childId, chore.id, chore.tasks[1]).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
        api.undo(childId, chore.id, chore.tasks[1], asParent = true)
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("REVOKE_CONFIRMATION_REQUIRED"))
            .andExpect(jsonPath("$.sticker.stickerId").value(stickerId))
        assertThat(liveRows(chore.id)).isEqualTo(1)

        api.undo(childId, chore.id, chore.tasks[1], asParent = true, query = "?revokeSticker=true")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.stickerId").value(stickerId))
            .andExpect(jsonPath("$.revoked.fromStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.chore.doneCount").value(1))
            .andExpect(jsonPath("$.chore.tasks[0].done").value(true))
            .andExpect(jsonPath("$.chore.tasks[1].done").value(false))
        assertThat(
            jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(stickerId).query(String::class.java).single(),
        ).isEqualTo("REVOKED")
        assertThat(liveRows(chore.id)).isZero()
        assertThat(count("SELECT COUNT(*) FROM chore_task WHERE chore_id = ? AND checked_at IS NOT NULL", chore.id)).isEqualTo(1)
        fetch(
            "/api/children/$childId/stickers",
        ).andExpect(jsonPath("$.items.length()").value(0)).andExpect(jsonPath("$.counts.available").value(0))
        api.chart(
            childId,
        ).andExpect(jsonPath("$.chores[0].choreId").value(chore.id)).andExpect(jsonPath("$.chores[0].state").value("IN_PROGRESS"))
        assertThat(listIds("filter=active")).containsExactly(chore.id)

        // the revocation is in History with the task label and the chore id
        fetch("/api/parent/children/$childId/history?from=today&to=today", api.parent).andExpect(status().isOk)
            .andExpect(jsonPath("$.days[0].revocations.length()").value(1))
            .andExpect(jsonPath("$.days[0].revocations[0].stickerId").value(stickerId))
            .andExpect(jsonPath("$.days[0].revocations[0].choreId").value(chore.id))
            .andExpect(jsonPath("$.days[0].revocations[0].taskLabel").value("Books away"))
            .andExpect(jsonPath("$.days[0].revocations[0].routineId").doesNotExist())

        // a repeat is 200 with no revoked, and changes nothing
        send(
            "DELETE",
            "$path?revokeSticker=true",
            null,
            api.parent,
        ).andExpect(status().isOk).andExpect(jsonPath("$.revoked").doesNotExist())
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation WHERE child_id = ?", childId)).isEqualTo(1)

        // checking the task again makes it ready, and finishing offers the same three
        check(chore, 1).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("READY_TO_FINISH"))
        val again = read(api.finish(childId, chore.id).andExpect(status().isOk))
        assertThat(long(again, "$.pick.stickerId")).isNotEqualTo(stickerId)
        assertThat(longs(again, "$.pick.choices[*].designId")).containsExactlyElementsOf(choices)
        assertThat(liveRows(chore.id)).isEqualTo(1)
        assertThat(stickerRows(chore.id)).isEqualTo(2)
    }

    @Test
    fun `revoking with removeChore leaves no chore anywhere and the repeat is 404`() {
        val chore = assign()
        val stickerId = earnAndClaim(chore)
        api.undo(childId, chore.id, chore.tasks[0], asParent = true, query = "?revokeSticker=true&removeChore=true")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.chore").doesNotExist())
            .andExpect(jsonPath("$.revoked.stickerId").value(stickerId))
        assertThat(choreIdsOnChart()).isEmpty()
        assertThat(listIds("filter=active")).isEmpty()
        assertThat(listIds("filter=closed")).isEmpty()
        assertThat(jdbc.sql("SELECT removed_at FROM chore WHERE id = ?").param(chore.id).query { rs, _ -> rs.getObject(1) }.list().single())
            .isNotNull()
        api.undo(childId, chore.id, chore.tasks[0], asParent = true, query = "?revokeSticker=true&removeChore=true")
            .andExpect(status().isNotFound)
        // the revoked sticker and its history stay
        fetch("/api/parent/children/$childId/history?from=today&to=today", api.parent)
            .andExpect(jsonPath("$.days[0].revocations.length()").value(1))
            .andExpect(jsonPath("$.days[0].revocations[0].choreId").value(chore.id))
        assertThat(stickerRows(chore.id)).isEqualTo(1)
    }

    @Test
    fun `revoking a pending chore sticker takes it out of its request and the last one cancels the request`() {
        val one = assign(name = "One")
        val two = assign(name = "Two")
        val stickerOne = earnAndClaim(one)
        val stickerTwo = earnAndClaim(two)
        val request = long(
            read(
                send(
                    "POST",
                    "/api/children/$childId/prize-requests",
                    """{"stickerIds":[$stickerOne,$stickerTwo]}""",
                ).andExpect(status().isCreated),
            ),
            "$.id",
        )
        api.undo(childId, one.id, one.tasks[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.fromStatus").value("PENDING"))
            .andExpect(jsonPath("$.revoked.prizeRequestId").value(request))
            .andExpect(jsonPath("$.revoked.requestCancelled").value(false))
        assertThat(
            jdbc.sql("SELECT status FROM prize_request WHERE id = ?").param(request).query(String::class.java).single(),
        ).isEqualTo("PENDING")
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE prize_request_id = ?", request)).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE id = ? AND prize_request_id IS NULL", stickerOne)).isEqualTo(1)
        fetch("/api/children/$childId/prize-requests/pending").andExpect(jsonPath("$.request.stickerCount").value(1))

        api.undo(childId, two.id, two.tasks[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.requestCancelled").value(true))
        assertThat(
            jdbc.sql("SELECT status FROM prize_request WHERE id = ?").param(request).query(String::class.java).single(),
        ).isEqualTo("CANCELLED")
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE prize_request_id = ?", request)).isZero()
        fetch("/api/children/$childId/prize-requests/pending").andExpect(jsonPath("$.request").doesNotExist())
    }

    @Test
    fun `a used chore sticker cannot be revoked`() {
        val chore = assign()
        val stickerId = earnAndClaim(chore)
        val request = long(
            read(send("POST", "/api/children/$childId/prize-requests", """{"stickerIds":[$stickerId]}""").andExpect(status().isCreated)),
            "$.id",
        )
        send("POST", "/api/parent/prize-requests/$request/complete", """{"prizeText":"Ice cream"}""", api.parent).andExpect(status().isOk)
        api.undo(childId, chore.id, chore.tasks[0], asParent = true, query = "?revokeSticker=true")
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("STICKER_USED"))
        api.chart(childId, asParent = true).andExpect(jsonPath("$.chores[0].sticker.revocable").value(false))
        assertThat(count("SELECT COUNT(*) FROM chore_task WHERE chore_id = ? AND checked_at IS NOT NULL", chore.id)).isEqualTo(2)
        assertThat(liveRows(chore.id)).isEqualTo(1)
    }

    // ---- done already

    @Test
    fun `a chore assigned as done already earns at once, skips the limit and its sticker is picked through the sticker endpoints`() {
        repeat(5) { assign(name = "Open $it") }
        val saved = read(
            api.assign(childId, api.body(name = "Already done", alreadyDone = true)).andExpect(status().isCreated)
                .andExpect(jsonPath("$.state").value("AWAITING_PICK")).andExpect(jsonPath("$.doneCount").value(2)),
        )
        val choreId = long(saved, "$.choreId")
        val stickerId = long(saved, "$.sticker.stickerId")
        assertThat(
            jdbc.sql("SELECT DISTINCT checked_by FROM chore_task WHERE chore_id = ?").param(choreId).query(String::class.java).list(),
        )
            .containsExactly("PARENT")
        assertThat(liveRows(choreId)).isEqualTo(1)

        val pick = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        val choices = longs(pick, "$.choices[*].designId")
        assertThat(choices).hasSize(3)
        claim(stickerId, choices[2]).andExpect(status().isOk)
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.items[0].source").value("CHORE"))
            .andExpect(jsonPath("$.items[0].routineName").value("Already done"))
        api.chart(childId).andExpect(jsonPath("$.chores[?(@.choreId == $choreId)].state").value("EARNED"))
    }

    // ---- the limit

    @Test
    fun `the sixth unfinished chore is refused and missed and finished chores do not count`() {
        val dueToday = assign(name = "Due today", due = today)
        val finished = assign(name = "Finished")
        repeat(3) { assign(name = "Open $it") }
        api.assign(
            childId,
            api.body(name = "Sixth"),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))

        finish(finished)
        at("2026-10-16T08:00:00Z") // "Due today" is missed now
        assertThat(listIds("filter=active")).hasSize(3).doesNotContain(dueToday.id)
        assign(name = "Fourth")
        assign(name = "Fifth")
        api.assign(
            childId,
            api.body(name = "Sixth"),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))

        // reopening the missed chore would make a sixth, so it is refused and stays missed
        api.save(dueToday.id, api.body(name = "Due today", due = null))
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))
        assertThat(listIds("filter=closed")).contains(dueToday.id)
        assertThat(listIds("filter=active")).hasSize(5)
    }

    @Test
    fun `a revoke may push a child to six unfinished chores but a new assign is still refused`() {
        val finished = assign(name = "Finished")
        earnAndClaim(finished)
        repeat(5) { assign(name = "Open $it") }
        api.undo(childId, finished.id, finished.tasks[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
        assertThat(listIds("filter=active")).hasSize(6)
        api.assign(
            childId,
            api.body(name = "Seventh"),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))
    }

    // ---- access

    @Test
    fun `every parent chore endpoint is 401 without a parent session and the child endpoints work without one`() {
        val chore = assign()
        send("POST", "/api/parent/children/$childId/chores", api.body()).andExpect(status().isUnauthorized)
        fetch("/api/parent/chores?filter=active").andExpect(status().isUnauthorized)
        fetch("/api/parent/chores?filter=closed").andExpect(status().isUnauthorized)
        fetch("/api/parent/chores/recent").andExpect(status().isUnauthorized)
        send("PUT", "/api/parent/chores/${chore.id}", api.body()).andExpect(status().isUnauthorized)
        send("DELETE", "/api/parent/chores/${chore.id}").andExpect(status().isUnauthorized)
        assertThat(count("SELECT COUNT(*) FROM chore WHERE child_id = ? AND removed_at IS NULL", childId)).isEqualTo(1)

        // the child's own endpoints need no session
        fetch("/api/children/$childId/days/today").andExpect(status().isOk).andExpect(jsonPath("$.chores.length()").value(1))
        check(chore, 0).andExpect(status().isOk)
        check(chore, 1).andExpect(status().isOk)
        api.undo(childId, chore.id, chore.tasks[1]).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
        check(chore, 1).andExpect(status().isOk)
        api.finish(childId, chore.id).andExpect(status().isOk).andExpect(jsonPath("$.chore.state").value("AWAITING_PICK"))
    }

    // ---- lists

    @Test
    fun `the family list covers every child child by child and the childId filter narrows it`() {
        val other = fixtures.createChild("John Doe")
        val a1 = assign(name = "A1")
        val b1 = assign(child = other, name = "B1")
        clock.advance(java.time.Duration.ofMinutes(1))
        val a2 = assign(name = "A2")
        val b2 = assign(child = other, name = "B2")
        assertThat(listIds("filter=active")).containsExactly(a1.id, a2.id, b1.id, b2.id)
        assertThat(listIds("filter=active&childId=$other")).containsExactly(b1.id, b2.id)
        assertThat(listIds("filter=active&childId=$childId")).containsExactly(a1.id, a2.id)
        assertThat(listIds("filter=closed")).isEmpty()
        api.list("filter=active").andExpect(jsonPath("$.items[0].childId").value(childId))
            .andExpect(jsonPath("$.items[0].tasks.length()").value(2)).andExpect(jsonPath("$.nextCursor").doesNotExist())
        finish(b1, other)
        assertThat(listIds("filter=closed")).containsExactly(b1.id)
        assertThat(listIds("filter=closed&childId=$childId")).isEmpty()
        assertThat(listIds("filter=active")).containsExactly(a1.id, a2.id, b2.id)
    }

    @Test
    fun `the closed list is newest first, pages 50 at a time and cuts a missed chore after 30 days`() {
        val design = fixtures.activeDesignIds().first()
        val ids = (0 until 55).map { i ->
            val chore = fixtures.createChore(childId, name = "Finished $i", checked = setOf(0, 1))
            fixtures.createChoreSticker(
                childId,
                chore.choreId,
                today.minusDays((i % 25).toLong()),
                StickerStatus.AVAILABLE,
                designId = design,
            )
            chore.choreId
        }
        val missedRecent = fixtures.createChore(childId, name = "Missed 3 days ago", dueDate = today.minusDays(3)).choreId
        val missedEdge = fixtures.createChore(childId, name = "Missed 30 days ago", dueDate = today.minusDays(30)).choreId
        val missedOld = fixtures.createChore(childId, name = "Missed 31 days ago", dueDate = today.minusDays(31)).choreId

        val page1 = read(api.list("filter=closed").andExpect(status().isOk))
        val cursor = text(page1, "$.nextCursor")
        assertThat(longs(page1, "$.items[*].choreId")).hasSize(50)
        val page2 = read(api.list("filter=closed&cursor=" + URLEncoder.encode(cursor, "UTF-8")).andExpect(status().isOk))
        assertThat(longs(page2, "$.items[*].choreId")).hasSize(7)
        assertThat(page2).contains("\"nextCursor\":null")

        val all = longs(page1, "$.items[*].choreId") + longs(page2, "$.items[*].choreId")
        assertThat(
            all,
        ).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(ids + listOf(missedRecent, missedEdge)).doesNotContain(missedOld)
        val closedOn = (JsonPathDates.read(page1, "$.items[*].closedOn") + JsonPathDates.read(page2, "$.items[*].closedOn"))
        assertThat(closedOn).isSortedAccordingTo(compareByDescending<LocalDate> { it })
        assertThat(closedOn.first()).isEqualTo(today)
        assertThat(all.last()).isEqualTo(missedEdge)
        // the day it was missed is its due date
        assertThat(closedOn.last()).isEqualTo(today.minusDays(30))
        assertThat(listIds("filter=active")).isEmpty()
    }

    @Test
    fun `recent chores are one per name, newest first, and include removed ones`() {
        val other = fixtures.createChild("John Doe")
        assign(name = "Water the plants")
        clock.advance(java.time.Duration.ofMinutes(1))
        val feed = assign(child = other, name = "Feed the fish")
        clock.advance(java.time.Duration.ofMinutes(1))
        assign(name = "Water the plants", tasks = listOf(TaskBody("Fill the can"), TaskBody("Pour", "droplet"), TaskBody("Put it back")))
        send("DELETE", "/api/parent/chores/${feed.id}", null, api.parent).andExpect(status().isNoContent)

        val body = read(api.recent().andExpect(status().isOk))
        assertThat(JsonPathDates.strings(body, "$[*].name")).containsExactly("Water the plants", "Feed the fish")
        assertThat(JsonPathDates.strings(body, "$[0].tasks[*].label")).containsExactly("Fill the can", "Pour", "Put it back")
        assertThat(text(body, "$[0].iconKey")).isEqualTo("broom")
    }
}

/** Small JsonPath readers for lists of dates and strings. */
private object JsonPathDates {
    fun strings(body: String, path: String): List<String> = com.jayway.jsonpath.JsonPath.read<List<String>>(body, path)

    fun read(body: String, path: String): List<LocalDate> = strings(body, path).map { LocalDate.parse(it) }
}
