package com.stickerbank.child

import com.stickerbank.common.ArtworkCatalog
import com.stickerbank.common.ArtworkUse
import com.stickerbank.common.ChildLock
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.Palette
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import java.sql.ResultSet
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset

@Service
class ChildService(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val artwork: ArtworkCatalog,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(ChildService::class.java)

    fun list(): List<ChildDto> = jdbc.sql("$SELECT WHERE archived_at IS NULL ORDER BY position, id").query { rs, _ -> map(rs) }.list()

    fun create(input: ChildInput): ChildDto {
        val valid = validate(input)
        val now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)
        val keys = GeneratedKeyHolder()
        jdbc.sql(
            "INSERT INTO child (name, avatar_key, theme_color, position, created_at, updated_at) " +
                "SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1, ?, ? FROM child",
        ).params(valid.name, valid.avatarKey, valid.themeColor, now, now).update(keys)
        return get(requireNotNull(keys.key).toLong())
    }

    fun update(childId: Long, input: ChildInput): ChildDto {
        val valid = validate(input)
        val now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)
        childLock.withChildLock(childId) {
            jdbc.sql("UPDATE child SET name = ?, avatar_key = ?, theme_color = ?, updated_at = ? WHERE id = ?")
                .params(valid.name, valid.avatarKey, valid.themeColor, now, childId).update()
        }
        return get(childId)
    }

    fun delete(childId: Long) {
        childLock.withChildLock(childId) {
            jdbc.sql("DELETE FROM child WHERE id = ?").param(childId).update()
        }
        log.info("child deleted id={}", childId)
    }

    private fun get(childId: Long): ChildDto = jdbc.sql("$SELECT WHERE id = ?").param(childId).query { rs, _ -> map(rs) }.optional()
        .orElseThrow { DomainException(ErrorCode.NOT_FOUND, "Child not found") }

    private fun validate(input: ChildInput): ChildInput {
        val name = ChildNameRules.normalize(input.name)
        artwork.require(input.avatarKey, ArtworkUse.AVATAR, "avatarKey")
        Palette.require(input.themeColor, "themeColor", nullable = false)
        return ChildInput(name, input.avatarKey, input.themeColor.uppercase())
    }

    private fun map(rs: ResultSet) = ChildDto(
        id = rs.getLong("id"),
        name = rs.getString("name"),
        avatarKey = rs.getString("avatar_key"),
        themeColor = rs.getString("theme_color"),
        position = rs.getInt("position"),
        createdAt = rs.getObject("created_at", LocalDateTime::class.java).toInstant(ZoneOffset.UTC),
    )

    private companion object {
        const val SELECT = "SELECT id, name, avatar_key, theme_color, position, created_at FROM child"
    }
}
