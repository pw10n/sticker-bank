package com.stickerbank.sticker.earning

import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.sticker.BookStickerDto
import com.stickerbank.sticker.StickerBookPageDto
import com.stickerbank.sticker.StickerCountsDto
import com.stickerbank.sticker.StickerDetailDto
import com.stickerbank.sticker.StickerPrizeDto
import com.stickerbank.sticker.StickerSource
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.sql.ResultSet
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

@Service
class StickerBookService(private val jdbc: JdbcClient) {
    companion object {
        const val DEFAULT_LIMIT = 100
        const val MAX_LIMIT = 200
        private val HIDDEN_FILTERS = setOf(StickerStatus.UNCLAIMED, StickerStatus.REVOKED)

        fun assembleCounts(byStatus: Map<StickerStatus, Int>): StickerCountsDto {
            val available = byStatus[StickerStatus.AVAILABLE] ?: 0
            val pending = byStatus[StickerStatus.PENDING] ?: 0
            val used = byStatus[StickerStatus.USED] ?: 0
            return StickerCountsDto(available, pending, used, available + pending + used, byStatus[StickerStatus.UNCLAIMED] ?: 0)
        }

        private fun invalid(field: String, message: String): Nothing =
            throw DomainException(ErrorCode.VALIDATION_FAILED, null, mapOf("fieldErrors" to listOf(FieldErrorDto(field, message))))

        private fun instant(rs: ResultSet, column: String): Instant? =
            rs.getObject(column, LocalDateTime::class.java)?.toInstant(ZoneOffset.UTC)
    }

    private val select =
        "SELECT s.id, s.child_id, s.status, s.source, s.chart_date, s.routine_name, s.routine_icon_key, s.earned_at, s.claimed_at, " +
            "s.prize_request_id, s.design_id, d.name AS design_name, d.artwork_key AS design_artwork FROM sticker s " +
            "LEFT JOIN sticker_design d ON d.id = s.design_id"

    private val liveSelect = select.replace("FROM sticker s", "FROM live_sticker s")

    fun counts(childId: Long): StickerCountsDto {
        val map = HashMap<StickerStatus, Int>()
        jdbc.sql("SELECT status, COUNT(*) AS n FROM live_sticker WHERE child_id = ? GROUP BY status").param(childId)
            .query { rs: ResultSet, _: Int -> map[StickerStatus.valueOf(rs.getString("status"))] = rs.getInt("n") }.list()
        return assembleCounts(map)
    }

    fun page(childId: Long, statusParam: String?, cursorParam: String?, limitParam: Int?): StickerBookPageDto {
        val status = statusParam?.let {
            val parsed = StickerStatus.entries.firstOrNull { s -> s.name == it }
            if (parsed == null || parsed in HIDDEN_FILTERS) invalid("status", "Must be AVAILABLE, PENDING or USED")
            parsed
        }
        val limit = limitParam ?: DEFAULT_LIMIT
        if (limit !in 1..MAX_LIMIT) invalid("limit", "Must be between 1 and $MAX_LIMIT")
        val cursor = cursorParam?.let { BookCursor.decode(it) ?: invalid("cursor", "Invalid cursor") }
        val exists = jdbc.sql("SELECT COUNT(*) FROM child WHERE id = ?").param(childId).query(Int::class.java).single() > 0
        if (!exists) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")

        val sql = StringBuilder("$liveSelect WHERE s.child_id = ? AND s.status <> 'UNCLAIMED'")
        val params = mutableListOf<Any>(childId)
        if (status != null) {
            sql.append(" AND s.status = ?")
            params += status.name
        }
        if (cursor != null) {
            sql.append(" AND (s.chart_date, s.earned_at, s.id) < (?, ?, ?)")
            params.addAll(listOf(cursor.chartDate, cursor.earnedAt, cursor.id))
        }
        sql.append(" ORDER BY s.chart_date DESC, s.earned_at DESC, s.id DESC LIMIT ?")
        params += limit + 1
        val rows = jdbc.sql(sql.toString()).params(params).query { rs: ResultSet, _: Int ->
            rs.getObject("earned_at", LocalDateTime::class.java) to toBook(rs)
        }.list()
        val pageRows = rows.take(limit)
        val next = if (rows.size > limit) {
            val (earned, last) = pageRows.last()
            BookCursor(last.chartDate, earned, last.stickerId).encode()
        } else {
            null
        }
        return StickerBookPageDto(counts(childId), pageRows.map { it.second }, next)
    }

    fun bookSticker(stickerId: Long): BookStickerDto =
        jdbc.sql("$select WHERE s.id = ?").param(stickerId).query { rs: ResultSet, _: Int -> toBook(rs) }.optional()
            .orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Sticker not found") }

    fun detail(stickerId: Long): StickerDetailDto {
        val row = jdbc.sql("$select WHERE s.id = ?").param(stickerId).query { rs: ResultSet, _: Int ->
            val designId = rs.getObject("design_id") as Long?
            val design = designId?.let { DesignRefDto(it, rs.getString("design_name"), rs.getString("design_artwork")) }
            val status = StickerStatus.valueOf(rs.getString("status"))
            StickerDetailDto(
                rs.getLong("id"), rs.getLong("child_id"), status, StickerSource.valueOf(rs.getString("source")),
                rs.getObject("chart_date", LocalDate::class.java), rs.getString("routine_name"), rs.getString("routine_icon_key"),
                design, instant(rs, "earned_at")!!, instant(rs, "claimed_at"), null,
            ) to (rs.getObject("prize_request_id") as Long?)
        }.optional().orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Sticker not found") }
        val (dto, prizeId) = row
        if (dto.status != StickerStatus.USED || prizeId == null) return dto
        val prize = jdbc.sql("SELECT id, prize_text, note, completed_at FROM prize_request WHERE id = ? AND status = 'COMPLETED'")
            .param(prizeId).query { rs: ResultSet, _: Int ->
                StickerPrizeDto(rs.getLong("id"), rs.getString("prize_text") ?: "", rs.getString("note"), instant(rs, "completed_at")!!)
            }.optional().orElse(null)
        return dto.copy(prize = prize)
    }

    private fun toBook(rs: ResultSet): BookStickerDto = BookStickerDto(
        rs.getLong("id"), rs.getLong("child_id"), StickerStatus.valueOf(rs.getString("status")),
        StickerSource.valueOf(rs.getString("source")), rs.getObject("chart_date", LocalDate::class.java),
        rs.getString("routine_name"), rs.getString("routine_icon_key"),
        DesignRefDto(rs.getLong("design_id"), rs.getString("design_name"), rs.getString("design_artwork")),
        instant(rs, "earned_at")!!, instant(rs, "claimed_at"), rs.getObject("prize_request_id") as Long?,
    )
}
