package com.stickerbank.chore

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

@IntegrationTest
@Import(FakeChoreRevokerConfig::class)
class ChoreIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var clock: MutableClock

    private lateinit var api: ChoreApi
    private var childId = 0L
    private val today = LocalDate.of(2026, 10, 15)
    private val yesterday = today.minusDays(1)

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        childId = fixtures.createChild("Jane Doe")
        api = ChoreApi(mvc, fixtures)
    }

    private fun stickerCount(choreId: Long) =
        jdbc.sql("SELECT COUNT(*) FROM sticker WHERE chore_id = ?").param(choreId).query(Long::class.java).single()

    private fun checked(taskId: Long): Pair<Boolean, String?> =
        jdbc.sql("SELECT checked_at, checked_by FROM chore_task WHERE id = ?").param(taskId)
            .query { rs, _ -> (rs.getObject("checked_at") != null) to rs.getString("checked_by") }.single()

    private fun fullChore(childId: Long = this.childId, due: LocalDate? = null, name: String = "Tidy playroom") =
        fixtures.createChore(childId, name = name, dueDate = due, checked = setOf(0, 1))

    private fun earned(f: com.stickerbank.support.ChoreFixture, date: LocalDate = today, status: StickerStatus = StickerStatus.AVAILABLE) =
        fixtures.createChoreSticker(
            childId,
            f.choreId,
            date,
            status,
            designId = if (status ==
                StickerStatus.UNCLAIMED
            ) {
                null
            } else {
                fixtures.activeDesignIds().first()
            },
        )

    // ---- assign

    @Test
    fun `assign inserts the chore and its unchecked tasks`() {
        api.assign(childId, api.body(name = "  Tidy up ", due = today.plusDays(2)))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.name").value("Tidy up"))
            .andExpect(jsonPath("$.childId").value(childId))
            .andExpect(jsonPath("$.state").value("NOT_STARTED"))
            .andExpect(jsonPath("$.dueDate").value(today.plusDays(2).toString()))
            .andExpect(jsonPath("$.taskCount").value(2))
            .andExpect(jsonPath("$.tasks[0].label").value("Blocks away"))
            .andExpect(jsonPath("$.tasks[1].done").value(false))
            .andExpect(jsonPath("$.sticker").doesNotExist())
    }

    @Test
    fun `assign collects every field error`() {
        api.assign(childId, api.body(name = " ", icon = "cat-face", due = yesterday, tasks = emptyList()))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors.length()").value(4))
    }

    @Test
    fun `assign to an unknown child is 404`() {
        api.assign(childId + 999).andExpect(status().isNotFound)
    }

    @Test
    fun `the sixth unfinished chore is refused, finished and missed ones do not count`() {
        repeat(4) { fixtures.createChore(childId, name = "Open $it") }
        val finished = fullChore(name = "Finished")
        earned(finished)
        fixtures.createChore(childId, name = "Missed", dueDate = yesterday)
        api.assign(childId).andExpect(status().isCreated)
        api.assign(
            childId,
            api.body(name = "Sixth"),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))
    }

    @Test
    fun `assign as already done checks every task as parent and earns a tapped sticker`() {
        api.assign(childId, api.body(alreadyDone = true))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.doneCount").value(2))
            .andExpect(jsonPath("$.sticker.status").value("UNCLAIMED"))
            .andExpect(jsonPath("$.sticker.autoFinished").value(false))
            .andExpect(jsonPath("$.closedOn").value(today.toString()))
        val row = jdbc.sql("SELECT chart_date, finish_mode, source FROM sticker").query { rs, _ ->
            Triple(rs.getObject("chart_date", LocalDate::class.java), rs.getString("finish_mode"), rs.getString("source"))
        }.single()
        assertThat(row).isEqualTo(Triple(today, "TAPPED", "CHORE"))
        val by = jdbc.sql("SELECT DISTINCT checked_by FROM chore_task").query(String::class.java).list()
        assertThat(by).containsExactly("PARENT")
    }

    @Test
    fun `already done skips the limit and takes no due date`() {
        repeat(5) { fixtures.createChore(childId, name = "Open $it") }
        api.assign(childId, api.body(alreadyDone = true)).andExpect(status().isCreated)
        api.assign(childId, api.body(alreadyDone = true, due = today)).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("dueDate"))
    }

    // ---- edit

    @Test
    fun `edit is refused with a live sticker`() {
        val f = fullChore()
        earned(f)
        api.save(f.choreId, api.body(tasks = listOf(TaskBody("A", id = f.taskIds[0]))))
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
    }

    @Test
    fun `edit keeps checks by id, adds unchecked tasks, deletes the others and follows the list order`() {
        val f = fixtures.createChore(
            childId,
            tasks = listOf("One" to "basket", "Two" to "basket", "Three" to "basket"),
            checked = setOf(0, 2),
        )
        api.save(
            f.choreId,
            api.body(
                name = "Renamed",
                tasks = listOf(TaskBody("New one"), TaskBody("Three renamed", id = f.taskIds[2]), TaskBody("One", id = f.taskIds[0])),
            ),
        ).andExpect(status().isOk)
            .andExpect(jsonPath("$.name").value("Renamed"))
            .andExpect(jsonPath("$.tasks[0].label").value("New one"))
            .andExpect(jsonPath("$.tasks[0].done").value(false))
            .andExpect(jsonPath("$.tasks[1].taskId").value(f.taskIds[2]))
            .andExpect(jsonPath("$.tasks[1].label").value("Three renamed"))
            .andExpect(jsonPath("$.tasks[1].done").value(true))
            .andExpect(jsonPath("$.tasks[2].taskId").value(f.taskIds[0]))
            .andExpect(jsonPath("$.tasks[2].done").value(true))
            .andExpect(jsonPath("$.taskCount").value(3))
        assertThat(jdbc.sql("SELECT COUNT(*) FROM chore_task WHERE id = ?").param(f.taskIds[1]).query(Long::class.java).single()).isZero()
    }

    @Test
    fun `an edit that leaves everything checked earns nothing`() {
        val f = fixtures.createChore(childId, checked = setOf(0))
        api.save(f.choreId, api.body(tasks = listOf(TaskBody("Only", id = f.taskIds[0]))))
            .andExpect(status().isOk).andExpect(jsonPath("$.state").value("READY_TO_FINISH"))
        assertThat(stickerCount(f.choreId)).isZero()
    }

    @Test
    fun `saving a missed chore reopens it with its checks`() {
        val f = fixtures.createChore(childId, dueDate = yesterday, checked = setOf(0))
        api.save(f.choreId, api.body(tasks = listOf(TaskBody("A", id = f.taskIds[0]), TaskBody("B", id = f.taskIds[1]))))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.dueDate").doesNotExist())
            .andExpect(jsonPath("$.tasks[0].done").value(true))
    }

    @Test
    fun `reopening a missed chore checks the limit, a plain edit does not`() {
        repeat(5) { fixtures.createChore(childId, name = "Open $it") }
        val missed = fixtures.createChore(childId, name = "Late", dueDate = yesterday)
        api.save(missed.choreId, api.body(tasks = listOf(TaskBody("A"))))
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))
        val open = jdbc.sql("SELECT id FROM chore WHERE name = 'Open 0'").query(Long::class.java).single()
        api.save(open, api.body(name = "Open 0 renamed", tasks = listOf(TaskBody("A")))).andExpect(status().isOk)
    }

    @Test
    fun `edit rejects a due date in the past, a foreign task id and alreadyDone`() {
        val f = fixtures.createChore(childId)
        val other = fixtures.createChore(childId, name = "Other")
        api.save(f.choreId, api.body(due = yesterday)).andExpect(status().isBadRequest)
        api.save(f.choreId, api.body(tasks = listOf(TaskBody("A", id = other.taskIds[0]))))
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("tasks[0].id"))
        api.save(f.choreId, api.body(alreadyDone = true)).andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("alreadyDone"))
    }

    @Test
    fun `edit of a removed or unknown chore is 404`() {
        val f = fixtures.createChore(childId, removed = true)
        api.save(f.choreId, api.body()).andExpect(status().isNotFound)
        api.save(f.choreId + 999, api.body()).andExpect(status().isNotFound)
    }

    // ---- remove

    @Test
    fun `remove is soft and a second call is still 204`() {
        val f = fixtures.createChore(childId)
        api.remove(f.choreId).andExpect(status().isNoContent)
        api.remove(f.choreId).andExpect(status().isNoContent)
        assertThat(
            jdbc.sql("SELECT removed_at FROM chore WHERE id = ?").param(f.choreId).query { rs, _ ->
                rs.getObject("removed_at")
            }.single(),
        )
            .isNotNull()
        api.remove(f.choreId + 999).andExpect(status().isNotFound)
    }

    @Test
    fun `remove is refused with a live sticker`() {
        val f = fullChore()
        earned(f)
        api.remove(f.choreId).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
    }

    // ---- check task

    @Test
    fun `check sets the check as the actor, keeps an existing one and earns nothing`() {
        val f = fixtures.createChore(childId, tasks = listOf("A" to "basket", "B" to "basket"))
        api.check(childId, f.choreId, f.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(checked(f.taskIds[0])).isEqualTo(true to "CHILD")
        api.check(childId, f.choreId, f.taskIds[0], asParent = true).andExpect(status().isOk)
        assertThat(checked(f.taskIds[0])).isEqualTo(true to "CHILD")
        api.check(childId, f.choreId, f.taskIds[1], asParent = true).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("READY_TO_FINISH"))
            .andExpect(jsonPath("$.chore.doneCount").value(2))
        assertThat(checked(f.taskIds[1])).isEqualTo(true to "PARENT")
        assertThat(stickerCount(f.choreId)).isZero()
    }

    @Test
    fun `check on a chore with a live sticker returns it unchanged`() {
        val f = fullChore()
        earned(f)
        jdbc.sql("UPDATE chore_task SET checked_at = NULL, checked_by = NULL WHERE id = ?").param(f.taskIds[1]).update()
        api.check(childId, f.choreId, f.taskIds[1]).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("EARNED"))
        assertThat(checked(f.taskIds[1]).first).isFalse()
    }

    @Test
    fun `check on a missed chore is refused`() {
        val f = fixtures.createChore(childId, dueDate = yesterday)
        api.check(childId, f.choreId, f.taskIds[0]).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_MISSED"))
        assertThat(checked(f.taskIds[0]).first).isFalse()
    }

    @Test
    fun `foreign, removed and mismatched chores and tasks are 404`() {
        val other = fixtures.createChild("John Doe")
        val mine = fixtures.createChore(childId)
        val theirs = fixtures.createChore(other)
        val removed = fixtures.createChore(childId, removed = true)
        api.check(childId, theirs.choreId, theirs.taskIds[0]).andExpect(status().isNotFound)
        api.check(childId, removed.choreId, removed.taskIds[0]).andExpect(status().isNotFound)
        api.check(childId, mine.choreId, theirs.taskIds[0]).andExpect(status().isNotFound)
        api.undo(childId, theirs.choreId, theirs.taskIds[0]).andExpect(status().isNotFound)
        api.finish(childId, theirs.choreId).andExpect(status().isNotFound)
        api.finish(childId, removed.choreId).andExpect(status().isNotFound)
    }

    // ---- undo task

    @Test
    fun `plain undo clears the check, also on a missed chore, and is idempotent`() {
        val f = fixtures.createChore(childId, checked = setOf(0, 1))
        api.undo(childId, f.choreId, f.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
        api.undo(childId, f.choreId, f.taskIds[0]).andExpect(status().isOk)
        assertThat(checked(f.taskIds[0])).isEqualTo(false to null)
        val missed = fixtures.createChore(childId, name = "Late", dueDate = yesterday, checked = setOf(0))
        api.undo(childId, missed.choreId, missed.taskIds[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("MISSED"))
        assertThat(checked(missed.taskIds[0]).first).isFalse()
    }

    @Test
    fun `undo on a ready to finish chore is a plain undo`() {
        val f = fullChore()
        api.undo(childId, f.choreId, f.taskIds[0]).andExpect(status().isOk).andExpect(jsonPath("$.revoked").doesNotExist())
    }

    @Test
    fun `undo with a live sticker is locked for the child`() {
        val f = fullChore()
        earned(f)
        api.undo(childId, f.choreId, f.taskIds[0]).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
        api.undo(childId, f.choreId, f.taskIds[0], query = "?revokeSticker=true").andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
    }

    @Test
    fun `parent undo without revokeSticker needs confirmation and changes nothing`() {
        val f = fullChore()
        val stickerId = earned(f)
        api.undo(childId, f.choreId, f.taskIds[0], asParent = true, query = "?removeChore=true")
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("REVOKE_CONFIRMATION_REQUIRED"))
            .andExpect(jsonPath("$.sticker.stickerId").value(stickerId))
            .andExpect(jsonPath("$.sticker.revocable").value(true))
        assertThat(checked(f.taskIds[0]).first).isTrue()
    }

    @Test
    fun `parent undo with revokeSticker revokes through the revoker and returns the reopened chore`() {
        val f = fullChore()
        val stickerId = earned(f)
        api.undo(childId, f.choreId, f.taskIds[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked.stickerId").value(stickerId))
            .andExpect(jsonPath("$.revoked.fromStatus").value("AVAILABLE"))
            .andExpect(jsonPath("$.pick").doesNotExist())
            .andExpect(jsonPath("$.chore.state").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.chore.sticker").doesNotExist())
        // a repeat finds no live sticker: the current state, no revoked
        api.undo(childId, f.choreId, f.taskIds[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.revoked").doesNotExist())
    }

    private fun one(sql: String, id: Long): Long = jdbc.sql(sql).param(id).query(Long::class.java).single()

    @Test
    fun `revoke with both flags and no parent session is locked and changes nothing`() {
        val f = fullChore()
        val id = earned(f)
        api.undo(childId, f.choreId, f.taskIds[0], query = "?revokeSticker=true&removeChore=true").andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
        assertThat(one("SELECT COUNT(*) FROM live_sticker WHERE id = ?", id)).isEqualTo(1)
        assertThat(one("SELECT COUNT(*) FROM chore WHERE id = ? AND removed_at IS NULL", f.choreId)).isEqualTo(1)
        assertThat(one("SELECT COUNT(*) FROM chore_task WHERE chore_id = ? AND checked_at IS NOT NULL", f.choreId)).isEqualTo(2)
    }

    @Test
    fun `revoke with removeChore answers no chore, and removeChore alone is ignored`() {
        val plain = fixtures.createChore(childId, name = "Plain", checked = setOf(0, 1))
        api.undo(childId, plain.choreId, plain.taskIds[0], asParent = true, query = "?removeChore=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.choreId").value(plain.choreId))
        val f = fullChore()
        earned(f)
        api.undo(childId, f.choreId, f.taskIds[0], asParent = true, query = "?revokeSticker=true&removeChore=true").andExpect(status().isOk)
            .andExpect(jsonPath("$.chore").doesNotExist())
            .andExpect(jsonPath("$.revoked.stickerId").exists())
        api.undo(
            childId,
            f.choreId,
            f.taskIds[0],
            asParent = true,
            query = "?revokeSticker=true&removeChore=true",
        ).andExpect(status().isNotFound)
    }

    // ---- finish

    @Test
    fun `finish earns one tapped sticker dated today with the chore's name and icon`() {
        val f = fullChore(name = "Feed the fish")
        api.finish(childId, f.choreId).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("AWAITING_PICK"))
            .andExpect(jsonPath("$.pick.choices.length()").value(3))
            .andExpect(jsonPath("$.pick.routineName").value("Feed the fish"))
        val row = jdbc.sql(
            "SELECT chart_date, finish_mode, routine_name, routine_icon_key FROM sticker WHERE chore_id = ?",
        ).param(f.choreId)
            .query { rs, _ ->
                listOf(
                    rs.getObject("chart_date", LocalDate::class.java),
                    rs.getString("finish_mode"),
                    rs.getString("routine_name"),
                    rs.getString("routine_icon_key"),
                )
            }.single()
        assertThat(row).containsExactly(today, "TAPPED", "Feed the fish", "broom")
    }

    @Test
    fun `finish is idempotent and returns the same three choices`() {
        val f = fullChore()
        val first = api.finish(childId, f.choreId).read<List<Int>>("$.pick.choices[*].designId")
        val second = api.finish(childId, f.choreId, asParent = true)
            .andExpect(jsonPath("$.chore.sticker.status").value("UNCLAIMED"))
            .read<List<Int>>("$.pick.choices[*].designId")
        assertThat(second).isEqualTo(first)
        assertThat(stickerCount(f.choreId)).isEqualTo(1)
    }

    @Test
    fun `finish of a claimed chore returns it with no pick`() {
        val f = fullChore()
        earned(f)
        api.finish(childId, f.choreId).andExpect(status().isOk)
            .andExpect(jsonPath("$.chore.state").value("EARNED"))
            .andExpect(jsonPath("$.pick").doesNotExist())
        assertThat(stickerCount(f.choreId)).isEqualTo(1)
    }

    @Test
    fun `finish with an unchecked task is not ready, on a missed chore it is missed`() {
        val f = fixtures.createChore(childId, checked = setOf(0))
        api.finish(childId, f.choreId).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_NOT_READY"))
        val missed = fixtures.createChore(childId, name = "Late", dueDate = yesterday, checked = setOf(0, 1))
        api.finish(childId, missed.choreId).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_MISSED"))
        assertThat(stickerCount(f.choreId) + stickerCount(missed.choreId)).isZero()
    }

    @Test
    fun `a finished chore can be revoked and finished again with the same choices`() {
        val f = fullChore()
        val first = api.finish(childId, f.choreId).read<List<Int>>("$.pick.choices[*].designId")
        api.undo(childId, f.choreId, f.taskIds[0], asParent = true, query = "?revokeSticker=true").andExpect(status().isOk)
        api.check(childId, f.choreId, f.taskIds[0]).andExpect(status().isOk)
        val again = api.finish(childId, f.choreId).read<List<Int>>("$.pick.choices[*].designId")
        assertThat(again).isEqualTo(first)
    }
}
