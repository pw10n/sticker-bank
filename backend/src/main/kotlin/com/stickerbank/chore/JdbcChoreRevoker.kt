package com.stickerbank.chore

import com.stickerbank.chart.RevokedStickerDto
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.StickerStatus
import com.stickerbank.revocation.RevocationService
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Revoking a chore's sticker (TDD 7.13 "Revoke", FR-13.23 to FR-13.25). The caller holds the child lock inside one
 * transaction and has already checked that the chore belongs to the child and is not removed. Only the chore's own
 * step differs from a routine revoke: the task's `checked_at` is cleared instead of a `task_completion` row deleted.
 * Everything else is the shared core, [RevocationService.revokeStickerLocked].
 */
@Component
class JdbcChoreRevoker(private val jdbc: JdbcClient, private val revocations: RevocationService, private val clock: FamilyClock) :
    ChoreRevoker {
    private val log = LoggerFactory.getLogger(javaClass)

    private data class LiveSticker(val id: Long, val status: StickerStatus)

    override fun revokeLocked(childId: Long, choreId: Long, taskId: Long, note: String?, removeChore: Boolean): RevokedStickerDto? {
        val sticker = jdbc.sql("SELECT id, status FROM live_sticker WHERE chore_id = ? AND child_id = ?")
            .params(choreId, childId)
            .query { rs, _ -> LiveSticker(rs.getLong("id"), StickerStatus.valueOf(rs.getString("status"))) }
            .list().firstOrNull()
            ?: return null // a repeated call: nothing left to revoke, and nothing changes
        // Both refusals come before any write, so a refused call leaves the check in place as well (FR-12.7).
        if (sticker.status == StickerStatus.USED) throw DomainException(ErrorCode.STICKER_USED)
        val label = jdbc.sql(
            "SELECT t.label FROM chore_task t JOIN chore c ON c.id = t.chore_id WHERE t.id = ? AND t.chore_id = ? AND c.child_id = ?",
        ).params(taskId, choreId, childId).query(String::class.java).list().firstOrNull()
            ?: throw DomainException(ErrorCode.NOT_FOUND, "Task not found")

        // Only task t is unchecked; the chore's other tasks stay checked (FR-13.25).
        jdbc.sql("UPDATE chore_task SET checked_at = NULL, checked_by = NULL WHERE id = ?").param(taskId).update()
        // task_id points at routine tasks, so a chore revoke records only the label (I-31).
        val revoked = revocations.revokeStickerLocked(childId, sticker.id, null, label, note)
        if (removeChore) {
            val now = LocalDateTime.ofInstant(clock.now(), ZoneOffset.UTC)
            jdbc.sql("UPDATE chore SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL")
                .params(now, now, choreId).update()
            log.info("chore removed childId={} choreId={}", childId, choreId)
        }
        return revoked
    }
}
