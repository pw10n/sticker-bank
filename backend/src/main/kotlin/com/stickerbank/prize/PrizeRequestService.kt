package com.stickerbank.prize

import com.stickerbank.common.Actor
import com.stickerbank.common.ChildLock
import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

@Service
class PrizeRequestService(private val jdbc: JdbcClient, private val childLock: ChildLock, private val clock: Clock) {
    private val log = LoggerFactory.getLogger(PrizeRequestService::class.java)

    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)

    private data class Row(
        val id: Long,
        val childId: Long,
        val childName: String,
        val status: PrizeRequestStatus,
        val createdBy: Actor,
        val prizeText: String?,
        val note: String?,
        val createdAt: LocalDateTime,
        val completedAt: LocalDateTime?,
        val cancelledAt: LocalDateTime?,
        val cancelledBy: Actor?,
        val cancelReason: PrizeCancelReason?,
        val reversedAt: LocalDateTime?,
    )

    fun pending(childId: Long): PendingPrizeRequestDto {
        requireChild(childId)
        val id = pendingId(childId)
        return PendingPrizeRequestDto(id?.let { load(listOf(it)).single() })
    }

    fun create(childId: Long, stickerIds: List<Long>?, actor: Actor): PrizeRequestDto {
        PrizeSupport.validateStickerIds(stickerIds)
        val ids = requireNotNull(stickerIds)
        val id =
            childLock.withChildLock(childId) {
                if (pendingId(childId) != null) throw DomainException(ErrorCode.PENDING_REQUEST_EXISTS)
                val found =
                    jdbc.sql("SELECT id, child_id, status FROM sticker WHERE id IN (:ids)")
                        .param("ids", ids)
                        .query { rs, _ -> Triple(rs.getLong("id"), rs.getLong("child_id"), rs.getString("status")) }
                        .list()
                        .associateBy { it.first }
                val offending = ids.filter { sid -> found[sid]?.let { it.second != childId || it.third != "AVAILABLE" } ?: true }
                if (offending.isNotEmpty()) {
                    throw DomainException(ErrorCode.STICKER_NOT_AVAILABLE, null, mapOf("stickerIds" to offending))
                }
                val now = now()
                val keys = GeneratedKeyHolder()
                jdbc.sql("INSERT INTO prize_request (child_id, status, created_by, created_at, updated_at) VALUES (?, 'PENDING', ?, ?, ?)")
                    .params(childId, actor.name, now, now)
                    .update(keys)
                val requestId = requireNotNull(keys.key).toLong()
                ids.forEach { sid ->
                    jdbc.sql("INSERT INTO prize_request_item (prize_request_id, sticker_id) VALUES (?, ?)").params(requestId, sid).update()
                }
                val updated =
                    jdbc.sql("UPDATE sticker SET status = 'PENDING', prize_request_id = :rid WHERE id IN (:ids) AND status = 'AVAILABLE'")
                        .param("rid", requestId)
                        .param("ids", ids)
                        .update()
                check(updated == ids.size) { "Expected to reserve ${ids.size} stickers but updated $updated" }
                requestId
            }
        log.info("Prize request {} created for child {} by {} with {} stickers", id, childId, actor, ids.size)
        return load(listOf(id)).single()
    }

    fun cancel(requestId: Long, actor: Actor): PrizeRequestDto {
        val childId = childIdOf(requestId)
        childLock.withChildLock(childId) {
            val status = statusOf(requestId)
            if (status != PrizeRequestStatus.PENDING) throw DomainException(ErrorCode.REQUEST_NOT_PENDING)
            val now = now()
            jdbc.sql("UPDATE sticker SET status = 'AVAILABLE', prize_request_id = NULL WHERE prize_request_id = ? AND status = 'PENDING'")
                .param(requestId).update()
            jdbc.sql(
                "UPDATE prize_request SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = 'CANCELLED', updated_at = ? WHERE id = ?",
            ).params(now, actor.name, now, requestId).update()
        }
        log.info("Prize request {} cancelled by {}", requestId, actor)
        return load(listOf(requestId)).single()
    }

    fun complete(requestId: Long, request: PrizeCompleteRequest): PrizeRequestDto {
        val prizeText = PrizeSupport.normalizePrizeText(request.prizeText)
        val note = PrizeSupport.normalizeNote(request.note)
        val childId = childIdOf(requestId)
        childLock.withChildLock(childId) {
            if (statusOf(requestId) != PrizeRequestStatus.PENDING) throw DomainException(ErrorCode.REQUEST_NOT_PENDING)
            val now = now()
            jdbc.sql("UPDATE sticker SET status = 'USED' WHERE prize_request_id = ? AND status = 'PENDING'").param(requestId).update()
            jdbc.sql(
                "UPDATE prize_request SET status = 'COMPLETED', prize_text = ?, note = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            ).params(listOf(prizeText, note, now, now, requestId)).update()
        }
        log.info("Prize request {} completed", requestId)
        return load(listOf(requestId)).single()
    }

    fun edit(requestId: Long, request: PrizeEditRequest): PrizeRequestDto {
        val prizeText = PrizeSupport.normalizePrizeText(request.prizeText)
        val note = PrizeSupport.normalizeNote(request.note)
        val childId = childIdOf(requestId)
        childLock.withChildLock(childId) {
            if (statusOf(requestId) != PrizeRequestStatus.COMPLETED) throw DomainException(ErrorCode.REQUEST_NOT_COMPLETED)
            jdbc.sql("UPDATE prize_request SET prize_text = ?, note = ?, updated_at = ? WHERE id = ?")
                .params(listOf(prizeText, note, now(), requestId)).update()
        }
        log.info("Prize request {} edited", requestId)
        return load(listOf(requestId)).single()
    }

    fun list(statuses: List<PrizeRequestStatus>?, childId: Long?, cursor: String?, limit: Int): PrizeRequestPageDto {
        PrizeSupport.validateLimit(limit)
        val decoded = cursor?.let { PrizeCursorCodec.decode(it) }
        val where = mutableListOf("1 = 1")
        val params = linkedMapOf<String, Any>()
        if (!statuses.isNullOrEmpty()) {
            where += "r.status IN (:statuses)"
            params["statuses"] = statuses.map { it.name }
        }
        if (childId != null) {
            where += "r.child_id = :childId"
            params["childId"] = childId
        }
        if (decoded != null) {
            where += "(r.created_at < :at OR (r.created_at = :at AND r.id < :cid))"
            params["at"] = LocalDateTime.ofInstant(Instant.ofEpochMilli(decoded.createdAtMillis), ZoneOffset.UTC)
            params["cid"] = decoded.id
        }
        params["lim"] = limit + 1
        val sql = "$SELECT_ROW WHERE ${where.joinToString(" AND ")} ORDER BY r.created_at DESC, r.id DESC LIMIT :lim"
        var q = jdbc.sql(sql)
        params.forEach { (k, v) -> q = q.param(k, v) }
        val rows = q.query { rs, _ -> mapRow(rs) }.list()
        val page = rows.take(limit)
        val next =
            if (rows.size > limit) {
                page.last().let { PrizeCursorCodec.encode(PrizeCursor(it.createdAt.toInstant(ZoneOffset.UTC).toEpochMilli(), it.id)) }
            } else {
                null
            }
        return PrizeRequestPageDto(assemble(page), next)
    }

    private fun requireChild(childId: Long) {
        val n = jdbc.sql("SELECT COUNT(*) FROM child WHERE id = ?").param(childId).query(Long::class.java).single()
        if (n == 0L) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
    }

    private fun pendingId(childId: Long): Long? =
        jdbc.sql("SELECT id FROM prize_request WHERE child_id = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1")
            .param(childId).query(Long::class.java).optional().orElse(null)

    private fun childIdOf(requestId: Long): Long = jdbc.sql("SELECT child_id FROM prize_request WHERE id = ?")
        .param(requestId).query(Long::class.java).optional()
        .orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Prize request not found") }

    /** Re-reads the status (call after taking the child lock). */
    private fun statusOf(requestId: Long): PrizeRequestStatus = jdbc.sql("SELECT status FROM prize_request WHERE id = ?")
        .param(requestId).query(String::class.java).optional()
        .map { PrizeRequestStatus.valueOf(it) }
        .orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Prize request not found") }

    private fun load(ids: List<Long>): List<PrizeRequestDto> {
        val rows = jdbc.sql("$SELECT_ROW WHERE r.id IN (:ids) ORDER BY r.created_at DESC, r.id DESC")
            .param("ids", ids).query { rs, _ -> mapRow(rs) }.list()
        return assemble(rows)
    }

    private fun assemble(rows: List<Row>): List<PrizeRequestDto> {
        if (rows.isEmpty()) return emptyList()
        val stickers = HashMap<Long, MutableList<PrizeStickerDto>>()
        jdbc.sql(
            """
            SELECT i.prize_request_id, s.id AS sticker_id, s.chart_date, s.routine_name,
                   s.status AS sticker_status, d.id AS design_id, d.name AS design_name, d.artwork_key
              FROM prize_request_item i
              JOIN sticker s ON s.id = i.sticker_id
              JOIN sticker_design d ON d.id = s.design_id
             WHERE i.prize_request_id IN (:ids)
             ORDER BY s.chart_date DESC, s.id DESC
            """.trimIndent(),
        ).param("ids", rows.map { it.id })
            .query { rs, _ ->
                stickers.getOrPut(rs.getLong("prize_request_id")) { mutableListOf() }.add(
                    PrizeStickerDto(
                        rs.getLong("sticker_id"),
                        rs.getObject("chart_date", java.time.LocalDate::class.java),
                        rs.getString("routine_name"),
                        DesignRefDto(rs.getLong("design_id"), rs.getString("design_name"), rs.getString("artwork_key")),
                        rs.getString("sticker_status") == "REVOKED",
                    ),
                )
            }.list()
        return rows.map { r ->
            val items = stickers[r.id].orEmpty()
            PrizeRequestDto(
                r.id, r.childId, r.childName, r.status, r.createdBy, items.count { !it.revoked }, items, r.prizeText, r.note,
                r.createdAt.toInstant(ZoneOffset.UTC), r.completedAt?.toInstant(ZoneOffset.UTC),
                r.cancelledAt?.toInstant(ZoneOffset.UTC), r.cancelledBy, r.cancelReason, r.reversedAt?.toInstant(ZoneOffset.UTC),
            )
        }
    }

    private fun mapRow(rs: ResultSet): Row {
        fun ts(col: String) = rs.getObject(col, LocalDateTime::class.java)
        return Row(
            rs.getLong("id"), rs.getLong("child_id"), rs.getString("child_name"),
            PrizeRequestStatus.valueOf(rs.getString("status")), Actor.valueOf(rs.getString("created_by")),
            rs.getString("prize_text"), rs.getString("note"), ts("created_at"), ts("completed_at"), ts("cancelled_at"),
            rs.getString("cancelled_by")?.let { Actor.valueOf(it) },
            rs.getString("cancel_reason")?.let { PrizeCancelReason.valueOf(it) }, ts("reversed_at"),
        )
    }

    private companion object {
        const val SELECT_ROW =
            "SELECT r.id, r.child_id, c.name AS child_name, r.status, r.created_by, r.prize_text, r.note, r.created_at, " +
                "r.completed_at, r.cancelled_at, r.cancelled_by, r.cancel_reason, r.reversed_at " +
                "FROM prize_request r JOIN child c ON c.id = r.child_id"
    }
}
