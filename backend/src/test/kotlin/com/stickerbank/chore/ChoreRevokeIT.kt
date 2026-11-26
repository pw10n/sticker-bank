package com.stickerbank.chore

import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.EarnSource
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerStatus
import com.stickerbank.flows.FlowTestBase
import com.stickerbank.support.ChoreFixture
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.support.GeneratedKeyHolder
import java.time.LocalDate
import java.time.LocalDateTime

/** Revoking a chore's sticker (TDD 7.13 "Revoke", FR-13.23 to FR-13.25, I-31), through the bean, under the child lock. */
@IntegrationTest
class ChoreRevokeIT : FlowTestBase() {
    @Autowired lateinit var childLock: ChildLock

    @Autowired lateinit var revoker: ChoreRevoker

    @Autowired lateinit var earner: StickerEarner

    private val today = LocalDate.of(2026, 10, 15)
    private val earnedOn = today.minusDays(2)
    private var childId = 0L
    private lateinit var chore: ChoreFixture
    private lateinit var choices: List<Long>

    @BeforeEach
    fun setUp() {
        childId = fixtures.createChild()
        chore = fixtures.createChore(childId, checked = setOf(0, 1))
        choices = fixtures.activeDesignIds().take(3)
    }

    private fun revoke(
        taskId: Long = chore.taskIds[1],
        note: String? = "Toys were back on the floor",
        removeChore: Boolean = false,
        choreId: Long = chore.choreId,
        child: Long = childId,
    ) = childLock.withChildLock(child) { revoker.revokeLocked(child, choreId, taskId, note, removeChore) }

    private fun choreSticker(status: StickerStatus, requestId: Long? = null, choreId: Long = chore.choreId): Long =
        fixtures.createChoreSticker(
            childId,
            choreId,
            earnedOn,
            status,
            designId = if (status == StickerStatus.UNCLAIMED) null else choices[0],
            prizeRequestId = requestId,
            choices = choices,
        )

    private fun createPendingRequest(): Long {
        val keys = GeneratedKeyHolder()
        jdbc.sql(
            "INSERT INTO prize_request (child_id, status, created_by, created_at, updated_at) " +
                "VALUES (?, 'PENDING', 'CHILD', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        ).param(childId).update(keys)
        return requireNotNull(keys.key).toLong()
    }

    private fun addItem(requestId: Long, stickerId: Long) {
        jdbc.sql("INSERT INTO prize_request_item (prize_request_id, sticker_id) VALUES (?, ?)").params(requestId, stickerId).update()
    }

    private fun status(stickerId: Long): String =
        jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(stickerId).query(String::class.java).single()

    private fun isLive(stickerId: Long): Any? = jdbc.sql("SELECT is_live FROM sticker WHERE id = ?").param(stickerId)
        .query { rs, _ -> rs.getObject(1) }.list().single()

    private fun stickerRequest(stickerId: Long): Long? = jdbc.sql("SELECT prize_request_id FROM sticker WHERE id = ?").param(stickerId)
        .query { rs, _ -> (rs.getObject(1) as Number?)?.toLong() }.list().single()

    private data class TaskCheck(val checkedAt: LocalDateTime?, val checkedBy: String?)

    private fun checks(fixture: ChoreFixture = chore): List<TaskCheck> =
        jdbc.sql("SELECT checked_at, checked_by FROM chore_task WHERE chore_id = ? ORDER BY position").param(fixture.choreId)
            .query { rs, _ -> TaskCheck(rs.getObject("checked_at", LocalDateTime::class.java), rs.getString("checked_by")) }.list()

    private fun savedChoices(stickerId: Long): List<Long> =
        jdbc.sql("SELECT design_id FROM sticker_pick_choice WHERE sticker_id = ? ORDER BY slot").param(stickerId)
            .query(Long::class.java).list().map { requireNotNull(it) }

    private fun revocationRow(stickerId: Long): Map<String, Any?> = jdbc.sql(
        "SELECT task_id, task_label, chart_date, note, from_status, prize_request_id, request_cancelled FROM sticker_revocation " +
            "WHERE sticker_id = ?",
    ).param(stickerId).query().singleRow()

    private fun removedAt(choreId: Long = chore.choreId): LocalDateTime? =
        jdbc.sql("SELECT removed_at FROM chore WHERE id = ?").param(choreId)
            .query { rs, _ -> rs.getObject("removed_at", LocalDateTime::class.java) }.list().single()

    private fun revocationCount(): Long = count("SELECT COUNT(*) FROM sticker_revocation WHERE child_id = ?", childId)

    private fun assertRevokedAndUnchecked(stickerId: Long) {
        assertThat(status(stickerId)).isEqualTo("REVOKED")
        assertThat(isLive(stickerId)).isNull()
        assertThat(stickerRequest(stickerId)).isNull()
        val after = checks()
        assertThat(after[0].checkedAt).isNotNull()
        assertThat(after[0].checkedBy).isEqualTo("CHILD")
        assertThat(after[1]).isEqualTo(TaskCheck(null, null))
        assertThat(removedAt()).isNull()
    }

    @Test
    fun `revoking an unclaimed chore sticker unchecks only that task and keeps the choices`() {
        val id = choreSticker(StickerStatus.UNCLAIMED)

        val revoked = revoke()

        assertThat(revoked?.stickerId).isEqualTo(id)
        assertThat(revoked?.fromStatus).isEqualTo(StickerStatus.UNCLAIMED)
        assertThat(revoked?.prizeRequestId).isNull()
        assertThat(revoked?.requestCancelled).isFalse()
        assertRevokedAndUnchecked(id)
        assertThat(savedChoices(id)).isEqualTo(choices)

        val row = revocationRow(id)
        assertThat(row["task_id"]).isNull()
        assertThat(row["task_label"]).isEqualTo("Books on the shelf")
        assertThat(row["chart_date"].toString()).isEqualTo(earnedOn.toString())
        assertThat(row["note"]).isEqualTo("Toys were back on the floor")
        assertThat(row["from_status"]).isEqualTo("UNCLAIMED")
        assertThat(row["prize_request_id"]).isNull()
    }

    @Test
    fun `revoking an available chore sticker and earning again offers the same choices in the same slots`() {
        val id = choreSticker(StickerStatus.AVAILABLE)

        val revoked = revoke(note = null)

        assertThat(revoked?.fromStatus).isEqualTo(StickerStatus.AVAILABLE)
        assertRevokedAndUnchecked(id)
        assertThat(savedChoices(id)).isEqualTo(choices)
        assertThat(revocationRow(id)["note"]).isNull()
        assertThat(revocationRow(id)["task_label"]).isEqualTo("Books on the shelf")

        fixtures.checkChoreTask(chore.taskIds[1])
        val pick = childLock.withChildLock(childId) {
            earner.earn(childId, EarnSource.Chore(chore.choreId), today, "Tidy the playroom", "broom", FinishMode.TAPPED)
        }
        assertThat(pick.stickerId).isNotEqualTo(id)
        assertThat(pick.status).isEqualTo(StickerStatus.UNCLAIMED)
        assertThat(pick.choices.map { it.designId }).isEqualTo(choices)
        assertThat(savedChoices(pick.stickerId)).isEqualTo(choices)
    }

    @Test
    fun `revoking a pending chore sticker that is one of several keeps the request pending`() {
        val requestId = createPendingRequest()
        val id = choreSticker(StickerStatus.PENDING, requestId)
        val other = fixtures.createChore(childId, name = "Feed the fish", checked = setOf(0, 1))
        val otherId = choreSticker(StickerStatus.PENDING, requestId, other.choreId)
        addItem(requestId, id)
        addItem(requestId, otherId)

        val revoked = revoke()

        assertThat(revoked?.fromStatus).isEqualTo(StickerStatus.PENDING)
        assertThat(revoked?.prizeRequestId).isEqualTo(requestId)
        assertThat(revoked?.requestCancelled).isFalse()
        assertRevokedAndUnchecked(id)
        assertThat(status(otherId)).isEqualTo("PENDING")
        assertThat(stickerRequest(otherId)).isEqualTo(requestId)
        assertThat(checks(other).all { it.checkedAt != null }).isTrue()
        assertThat(count("SELECT COUNT(*) FROM prize_request WHERE id = ? AND status = 'PENDING'", requestId)).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM prize_request_item WHERE prize_request_id = ?", requestId)).isEqualTo(2)
        assertThat(revocationRow(id)["prize_request_id"]).isEqualTo(requestId)
        assertThat(revocationRow(id)["request_cancelled"]).isEqualTo(false)
    }

    @Test
    fun `revoking the last pending sticker of a request cancels the request`() {
        val requestId = createPendingRequest()
        val id = choreSticker(StickerStatus.PENDING, requestId)
        addItem(requestId, id)

        val revoked = revoke()

        assertThat(revoked?.fromStatus).isEqualTo(StickerStatus.PENDING)
        assertThat(revoked?.prizeRequestId).isEqualTo(requestId)
        assertThat(revoked?.requestCancelled).isTrue()
        assertRevokedAndUnchecked(id)
        val request = jdbc.sql("SELECT status, cancelled_by, cancel_reason, cancelled_at FROM prize_request WHERE id = ?")
            .param(requestId).query().singleRow()
        assertThat(request["status"]).isEqualTo("CANCELLED")
        assertThat(request["cancelled_by"]).isEqualTo("PARENT")
        assertThat(request["cancel_reason"]).isEqualTo("ALL_STICKERS_REVOKED")
        assertThat(request["cancelled_at"]).isNotNull()
        assertThat(count("SELECT COUNT(*) FROM prize_request_item WHERE prize_request_id = ?", requestId)).isEqualTo(1)
        assertThat(revocationRow(id)["request_cancelled"]).isEqualTo(true)
    }

    @Test
    fun `a used chore sticker cannot be revoked and nothing changes`() {
        val keys = GeneratedKeyHolder()
        jdbc.sql(
            "INSERT INTO prize_request (child_id, status, created_by, prize_text, created_at, completed_at, updated_at) " +
                "VALUES (?, 'COMPLETED', 'CHILD', 'Ice cream', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        ).param(childId).update(keys)
        val requestId = requireNotNull(keys.key).toLong()
        val id = choreSticker(StickerStatus.USED, requestId)
        addItem(requestId, id)
        val before = checks()

        assertThatThrownBy { revoke(removeChore = true) }
            .isInstanceOfSatisfying(DomainException::class.java) { assertThat(it.code).isEqualTo(ErrorCode.STICKER_USED) }

        assertThat(status(id)).isEqualTo("USED")
        assertThat(stickerRequest(id)).isEqualTo(requestId)
        assertThat(checks()).isEqualTo(before)
        assertThat(checks().all { it.checkedAt != null }).isTrue()
        assertThat(revocationCount()).isZero()
        assertThat(removedAt()).isNull()
        assertThat(count("SELECT COUNT(*) FROM prize_request WHERE id = ? AND status = 'COMPLETED'", requestId)).isEqualTo(1)
    }

    @Test
    fun `removeChore also removes the chore in the same call`() {
        val id = choreSticker(StickerStatus.AVAILABLE)

        val revoked = revoke(removeChore = true)

        assertThat(revoked?.stickerId).isEqualTo(id)
        assertThat(status(id)).isEqualTo("REVOKED")
        assertThat(removedAt()).isEqualTo(LocalDateTime.of(2026, 10, 15, 15, 0))
        assertThat(checks()[1]).isEqualTo(TaskCheck(null, null))
        assertThat(revocationCount()).isEqualTo(1)
    }

    @Test
    fun `with no live sticker it returns null and changes nothing`() {
        // never finished
        val before = checks()
        assertThat(revoke(removeChore = true)).isNull()
        assertThat(checks()).isEqualTo(before)
        assertThat(removedAt()).isNull()

        // a repeated call after a revoke: the sticker is already REVOKED
        val id = choreSticker(StickerStatus.AVAILABLE)
        assertThat(revoke()).isNotNull()
        fixtures.checkChoreTask(chore.taskIds[1])
        val afterFirst = checks()
        assertThat(revoke(removeChore = true)).isNull()
        assertThat(checks()).isEqualTo(afterFirst)
        assertThat(removedAt()).isNull()
        assertThat(status(id)).isEqualTo("REVOKED")
        assertThat(revocationCount()).isEqualTo(1)
    }

    @Test
    fun `another child's chore is not revoked`() {
        val id = choreSticker(StickerStatus.AVAILABLE)
        val otherChild = fixtures.createChild(name = "John Doe")

        assertThat(revoke(child = otherChild)).isNull()

        assertThat(status(id)).isEqualTo("AVAILABLE")
        assertThat(checks().all { it.checkedAt != null }).isTrue()
        assertThat(revocationCount()).isZero()
    }

    @Test
    fun `a task of another chore is refused before anything changes`() {
        val id = choreSticker(StickerStatus.AVAILABLE)
        val other = fixtures.createChore(childId, name = "Feed the fish", checked = setOf(0, 1))

        assertThatThrownBy { revoke(taskId = other.taskIds[0]) }
            .isInstanceOfSatisfying(DomainException::class.java) { assertThat(it.code).isEqualTo(ErrorCode.NOT_FOUND) }

        assertThat(status(id)).isEqualTo("AVAILABLE")
        assertThat(checks().all { it.checkedAt != null }).isTrue()
        assertThat(checks(other).all { it.checkedAt != null }).isTrue()
        assertThat(revocationCount()).isZero()
    }

    @Test
    fun `a chore revoke leaves a routine sticker of the same child untouched`() {
        val routine = fixtures.createRoutine(childId)
        routine.taskIds.forEach { fixtures.completeTask(childId, routine.routineId, it, earnedOn) }
        val routineSticker = fixtures.createSticker(childId, routine.routineId, earnedOn, StickerStatus.AVAILABLE, choices[1])
        val id = choreSticker(StickerStatus.AVAILABLE)

        revoke()

        assertThat(status(id)).isEqualTo("REVOKED")
        assertThat(status(routineSticker)).isEqualTo("AVAILABLE")
        assertThat(isLive(routineSticker)).isNotNull()
        assertThat(count("SELECT COUNT(*) FROM task_completion WHERE routine_id = ?", routine.routineId)).isEqualTo(2)
        assertThat(count("SELECT COUNT(*) FROM sticker_revocation WHERE sticker_id = ?", routineSticker)).isZero()
    }
}
