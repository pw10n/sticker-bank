package com.stickerbank.sticker.earning

import com.stickerbank.common.ChildLock
import com.stickerbank.common.DesignRefDto
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.sticker.BookStickerDto
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.random.RandomGenerator

@Service
class StickerPickService(
    private val jdbc: JdbcClient,
    private val clock: Clock,
    private val random: RandomGenerator,
    private val childLock: ChildLock,
    private val book: StickerBookService,
) : StickerEarner {
    private val log = LoggerFactory.getLogger(StickerPickService::class.java)

    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)

    override fun earn(
        childId: Long,
        routineId: Long,
        chartDate: LocalDate,
        routineName: String,
        routineIconKey: String,
        finishMode: FinishMode,
        earnedAt: Instant?,
    ): StickerPickDto {
        val now = earnedAt?.let { LocalDateTime.ofInstant(it, ZoneOffset.UTC) } ?: now()
        val keys = GeneratedKeyHolder()
        jdbc.sql(
            "INSERT INTO sticker (child_id, source, routine_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
                "earned_at, finish_mode) VALUES (?, 'ROUTINE', ?, ?, ?, ?, NULL, 'UNCLAIMED', ?, ?)",
        ).params(childId, routineId, chartDate, routineName, routineIconKey, now, finishMode.name).update(keys)
        val stickerId = requireNotNull(keys.key).toLong()

        val pool = jdbc.sql(
            """
            SELECT d.id FROM sticker_design d
              LEFT JOIN sticker_category c ON c.id = d.category_id
             WHERE d.status = 'ACTIVE' AND d.is_fallback = FALSE AND (d.category_id IS NULL OR c.enabled = TRUE)
            """.trimIndent(),
        ).query(Long::class.java).list().map { requireNotNull(it) }

        val result = if (pool.isEmpty()) {
            val fallbackId = jdbc.sql("SELECT id FROM sticker_design WHERE is_fallback = TRUE ORDER BY id LIMIT 1")
                .query(Long::class.java).single()
            jdbc.sql("UPDATE sticker SET design_id = ?, status = 'AVAILABLE', claimed_at = ? WHERE id = ?")
                .params(fallbackId, now, stickerId).update()
            StickerPickDto(
                stickerId = stickerId,
                childId = childId,
                chartDate = chartDate,
                routineName = routineName,
                status = StickerStatus.AVAILABLE,
                autoAwarded = true,
                choices = emptyList(),
                claimed = designRef(fallbackId),
            )
        } else {
            val chosen = ChoiceSelector.select(pool, random)
            chosen.forEachIndexed { index, designId ->
                jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)")
                    .params(stickerId, index + 1, designId).update()
            }
            StickerPickDto(
                stickerId = stickerId,
                childId = childId,
                chartDate = chartDate,
                routineName = routineName,
                status = StickerStatus.UNCLAIMED,
                autoAwarded = false,
                choices = choicesOf(stickerId),
                claimed = null,
            )
        }
        log.info("sticker earned stickerId={} childId={} chartDate={} finishMode={}", stickerId, childId, chartDate, finishMode)
        return result
    }

    override fun getPick(stickerId: Long): StickerPickDto {
        val row = jdbc.sql(
            "SELECT s.id, s.child_id, s.chart_date, s.routine_name, s.status, s.design_id, d.is_fallback " +
                "FROM sticker s LEFT JOIN sticker_design d ON d.id = s.design_id WHERE s.id = ?",
        ).param(stickerId).query { rs: ResultSet, _: Int ->
            PickRow(
                id = rs.getLong("id"),
                childId = rs.getLong("child_id"),
                chartDate = rs.getObject("chart_date", LocalDate::class.java),
                routineName = rs.getString("routine_name"),
                status = StickerStatus.valueOf(rs.getString("status")),
                designId = rs.getObject("design_id") as Long?,
                fallback = rs.getBoolean("is_fallback"),
            )
        }.optional().orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Sticker not found") }
        return if (row.status == StickerStatus.UNCLAIMED) {
            StickerPickDto(
                stickerId = row.id,
                childId = row.childId,
                chartDate = row.chartDate,
                routineName = row.routineName,
                status = row.status,
                autoAwarded = false,
                choices = choicesOf(row.id),
                claimed = null,
            )
        } else {
            StickerPickDto(
                stickerId = row.id,
                childId = row.childId,
                chartDate = row.chartDate,
                routineName = row.routineName,
                status = row.status,
                autoAwarded = row.fallback,
                choices = emptyList(),
                claimed = row.designId?.let { designRef(it) },
            )
        }
    }

    fun claim(stickerId: Long, designId: Long): BookStickerDto {
        val childId = jdbc.sql("SELECT child_id FROM sticker WHERE id = ?").param(stickerId).query(Long::class.java).optional()
            .orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Sticker not found") }
        return childLock.withChildLock(childId) {
            val (status, current) = jdbc.sql("SELECT status, design_id FROM sticker WHERE id = ?").param(stickerId)
                .query { rs: ResultSet, _: Int ->
                    rs.getString("status") to rs.getObject("design_id") as Long?
                }
                .optional().orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Sticker not found") }
            if (status == StickerStatus.REVOKED.name) throw DomainException(ErrorCode.STICKER_REVOKED)
            if (status != StickerStatus.UNCLAIMED.name) {
                if (current != designId) throw DomainException(ErrorCode.ALREADY_CLAIMED)
            } else {
                val offered = jdbc.sql("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ? AND design_id = ?")
                    .params(stickerId, designId).query(Int::class.java).single() > 0
                if (!offered) throw DomainException(ErrorCode.CHOICE_NOT_OFFERED)
                jdbc.sql("UPDATE sticker SET design_id = ?, status = 'AVAILABLE', claimed_at = ? WHERE id = ?")
                    .params(designId, now(), stickerId).update()
                jdbc.sql("DELETE FROM sticker_pick_choice WHERE sticker_id = ?").param(stickerId).update()
                log.info("pick claimed stickerId={} childId={} designId={}", stickerId, childId, designId)
            }
            book.bookSticker(stickerId)
        }
    }

    private fun designRef(designId: Long): DesignRefDto =
        jdbc.sql("SELECT id, name, artwork_key FROM sticker_design WHERE id = ?").param(designId)
            .query { rs: ResultSet, _: Int -> DesignRefDto(rs.getLong("id"), rs.getString("name"), rs.getString("artwork_key")) }
            .single()

    private fun choicesOf(stickerId: Long): List<DesignRefDto> = jdbc.sql(
        "SELECT d.id, d.name, d.artwork_key FROM sticker_pick_choice c JOIN sticker_design d ON d.id = c.design_id " +
            "WHERE c.sticker_id = ? ORDER BY c.slot",
    ).param(stickerId)
        .query { rs: ResultSet, _: Int -> DesignRefDto(rs.getLong("id"), rs.getString("name"), rs.getString("artwork_key")) }
        .list()

    private data class PickRow(
        val id: Long,
        val childId: Long,
        val chartDate: LocalDate,
        val routineName: String?,
        val status: StickerStatus,
        val designId: Long?,
        val fallback: Boolean,
    )
}
