package com.stickerbank.sticker.library

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.ArtworkUse
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.sticker.CategoryDto
import com.stickerbank.sticker.CategoryInput
import com.stickerbank.sticker.DesignDto
import com.stickerbank.sticker.DesignInput
import com.stickerbank.sticker.DesignStatus
import com.stickerbank.sticker.LibraryDto
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.sql.ResultSet
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset

@Service
class LibraryService(private val jdbc: JdbcClient, private val clock: Clock, private val artwork: ArtworkCatalog) {
    private val log = LoggerFactory.getLogger(LibraryService::class.java)

    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)

    // ---- designs ----

    @Transactional(readOnly = true)
    fun list(q: String?, status: DesignStatus?, categoryId: Long?): LibraryDto {
        val where = StringBuilder("d.is_fallback = FALSE")
        val params = mutableListOf<Any>()
        if (!q.isNullOrBlank()) {
            where.append(" AND LOWER(d.name) LIKE ? ESCAPE '\\\\'")
            params += "%" + LibrarySupport.escapeLike(q.trim().lowercase()) + "%"
        }
        if (status != null) {
            where.append(" AND d.status = ?")
            params += status.name
        }
        if (categoryId != null) {
            where.append(" AND d.category_id = ?")
            params += categoryId
        }
        val designs = jdbc.sql(
            "$SELECT_DESIGN WHERE $where ORDER BY (c.position IS NULL), c.position, d.name, d.id",
        ).params(params).query(::mapDesign).list()
        val active = jdbc.sql(
            """
            SELECT COUNT(*) FROM sticker_design d LEFT JOIN sticker_category c ON c.id = d.category_id
             WHERE d.status = 'ACTIVE' AND d.is_fallback = FALSE AND (d.category_id IS NULL OR c.enabled = TRUE)
            """.trimIndent(),
        ).query(Int::class.java).single()
        return LibraryDto(active, designs)
    }

    @Transactional
    fun create(input: DesignInput): DesignDto {
        val name = LibrarySupport.validName(input.name)
        validateArtworkAndCategory(input)
        val now = now()
        val keys = GeneratedKeyHolder()
        jdbc.sql(
            "INSERT INTO sticker_design (name, artwork_key, category_id, status, is_fallback, created_at, updated_at) " +
                "VALUES (?, ?, ?, 'ACTIVE', FALSE, ?, ?)",
        ).params(listOf(name, input.artworkKey, input.categoryId, now, now)).update(keys)
        val id = requireNotNull(keys.key).toLong()
        log.info("Sticker design created id={}", id)
        return get(id)
    }

    @Transactional
    fun update(id: Long, input: DesignInput): DesignDto {
        requireDesign(id)
        val name = LibrarySupport.validName(input.name)
        validateArtworkAndCategory(input)
        jdbc.sql("UPDATE sticker_design SET name = ?, artwork_key = ?, category_id = ?, updated_at = ? WHERE id = ?")
            .params(listOf(name, input.artworkKey, input.categoryId, now(), id)).update()
        log.info("Sticker design edited id={}", id)
        return get(id)
    }

    @Transactional
    fun setStatus(id: Long, status: DesignStatus): DesignDto {
        requireDesign(id)
        jdbc.sql("UPDATE sticker_design SET status = ?, updated_at = ? WHERE id = ?").params(status.name, now(), id).update()
        log.info("Sticker design status changed id={} status={}", id, status)
        return get(id)
    }

    fun delete(id: Long) {
        try {
            deleteInternal(id)
        } catch (e: DataIntegrityViolationException) {
            throw inUse()
        }
    }

    private fun deleteInternal(id: Long) {
        requireDesign(id)
        if (get(id).inUse) throw inUse()
        jdbc.sql("DELETE FROM sticker_design WHERE id = ? AND is_fallback = FALSE").param(id).update()
        log.info("Sticker design deleted id={}", id)
    }

    private fun inUse() = DomainException(ErrorCode.DESIGN_IN_USE, "This sticker has been earned. Retire it instead.")

    fun get(id: Long): DesignDto =
        jdbc.sql("$SELECT_DESIGN WHERE d.id = ? AND d.is_fallback = FALSE").param(id).query(::mapDesign).optional()
            .orElseThrow { DomainException(ErrorCode.NOT_FOUND) }

    private fun requireDesign(id: Long) {
        val exists = jdbc.sql("SELECT COUNT(*) FROM sticker_design WHERE id = ? AND is_fallback = FALSE").param(id)
            .query(Int::class.java).single() > 0
        if (!exists) throw DomainException(ErrorCode.NOT_FOUND)
    }

    private fun validateArtworkAndCategory(input: DesignInput) {
        artwork.require(input.artworkKey, ArtworkUse.STICKER, "artworkKey")
        if (input.categoryId != null && !categoryExists(input.categoryId)) {
            throw LibrarySupport.validation("categoryId", "Unknown category")
        }
    }

    private fun categoryExists(id: Long): Boolean =
        jdbc.sql("SELECT COUNT(*) FROM sticker_category WHERE id = ?").param(id).query(Int::class.java).single() > 0

    // ---- categories ----

    @Transactional(readOnly = true)
    fun categories(): List<CategoryDto> = jdbc.sql("$SELECT_CATEGORY ORDER BY c.position, c.id").query(::mapCategory).list()

    private fun category(id: Long): CategoryDto = jdbc.sql("$SELECT_CATEGORY WHERE c.id = ?").param(id).query(::mapCategory).optional()
        .orElseThrow { DomainException(ErrorCode.NOT_FOUND) }

    @Transactional
    fun createCategory(input: CategoryInput): CategoryDto {
        val name = LibrarySupport.validName(input.name)
        checkNameFree(name, null)
        val position = jdbc.sql("SELECT COALESCE(MAX(position), 0) + 1 FROM sticker_category").query(Int::class.java).single()
        val keys = GeneratedKeyHolder()
        try {
            jdbc.sql("INSERT INTO sticker_category (name, enabled, position) VALUES (?, ?, ?)")
                .params(name, input.enabled, position).update(keys)
        } catch (e: DuplicateKeyException) {
            throw duplicate()
        }
        val id = requireNotNull(keys.key).toLong()
        log.info("Sticker category created id={}", id)
        return category(id)
    }

    @Transactional
    fun updateCategory(id: Long, input: CategoryInput): CategoryDto {
        category(id)
        val name = LibrarySupport.validName(input.name)
        checkNameFree(name, id)
        try {
            jdbc.sql("UPDATE sticker_category SET name = ?, enabled = ? WHERE id = ?").params(name, input.enabled, id).update()
        } catch (e: DuplicateKeyException) {
            throw duplicate()
        }
        log.info("Sticker category edited id={} enabled={}", id, input.enabled)
        return category(id)
    }

    @Transactional
    fun deleteCategory(id: Long) {
        category(id)
        jdbc.sql("DELETE FROM sticker_category WHERE id = ?").param(id).update()
        log.info("Sticker category deleted id={}", id)
    }

    private fun checkNameFree(name: String, selfId: Long?) {
        val taken = jdbc.sql("SELECT COUNT(*) FROM sticker_category WHERE name = ? AND id <> ?")
            .params(name, selfId ?: -1L).query(Int::class.java).single() > 0
        if (taken) throw duplicate()
    }

    private fun duplicate() = LibrarySupport.validation("name", "A category with this name already exists")

    private fun mapDesign(rs: ResultSet, @Suppress("UNUSED_PARAMETER") row: Int): DesignDto = DesignDto(
        id = rs.getLong("id"),
        name = rs.getString("name"),
        artworkKey = rs.getString("artwork_key"),
        categoryId = rs.getLong("category_id").takeUnless { rs.wasNull() },
        categoryName = rs.getString("category_name"),
        status = DesignStatus.valueOf(rs.getString("status")),
        inUse = rs.getBoolean("in_use"),
        createdAt = rs.getObject("created_at", LocalDateTime::class.java).toInstant(ZoneOffset.UTC),
    )

    private fun mapCategory(rs: ResultSet, @Suppress("UNUSED_PARAMETER") row: Int): CategoryDto = CategoryDto(
        id = rs.getLong("id"),
        name = rs.getString("name"),
        enabled = rs.getBoolean("enabled"),
        position = rs.getInt("position"),
        designCount = rs.getInt("design_count"),
    )

    private companion object {
        const val SELECT_DESIGN = """
            SELECT d.id, d.name, d.artwork_key, d.category_id, c.name AS category_name, d.status, d.created_at,
                   (EXISTS (SELECT 1 FROM sticker s WHERE s.design_id = d.id)
                    OR EXISTS (SELECT 1 FROM sticker_pick_choice pc WHERE pc.design_id = d.id)) AS in_use
              FROM sticker_design d LEFT JOIN sticker_category c ON c.id = d.category_id"""

        const val SELECT_CATEGORY = """
            SELECT c.id, c.name, c.enabled, c.position,
                   (SELECT COUNT(*) FROM sticker_design d WHERE d.category_id = c.id AND d.is_fallback = FALSE) AS design_count
              FROM sticker_category c"""
    }
}
