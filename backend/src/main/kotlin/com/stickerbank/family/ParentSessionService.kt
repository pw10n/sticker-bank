package com.stickerbank.family

import com.stickerbank.common.ParentSessionCookie
import com.stickerbank.common.ParentSessionReader
import com.stickerbank.common.StickerBankProperties
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.ResponseCookie
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

data class StartedSession(val cookie: ResponseCookie, val dto: ParentSessionDto)

fun utc(instant: Instant): LocalDateTime = LocalDateTime.ofInstant(instant, ZoneOffset.UTC)

fun utc(local: LocalDateTime): Instant = local.toInstant(ZoneOffset.UTC)

/** Parent session storage. Only the SHA-256 of the cookie token is stored. */
@Component
class ParentSessionService(private val jdbc: JdbcClient, private val clock: Clock, private val props: StickerBankProperties) {
    private val log = LoggerFactory.getLogger(ParentSessionService::class.java)

    private data class Row(val lastSeenAt: Instant, val expiresAt: Instant, val idleSeconds: Int)

    fun start(): StartedSession {
        val now = clock.instant()
        val token = ParentSessionCookie.newToken()
        val expiresAt = now.plus(props.parentSession.absoluteMax)
        jdbc.sql("DELETE FROM parent_session WHERE expires_at <= ?").param(utc(now)).update()
        jdbc.sql("INSERT INTO parent_session (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)")
            .params(ParentSessionCookie.hash(token), utc(now), utc(now), utc(expiresAt)).update()
        log.info("parent session started")
        val idle = idleTimeoutSeconds()
        return StartedSession(
            ParentSessionCookies.issue(token, props.parentSession),
            ParentSessionDto(idle, now.plusSeconds(idle.toLong()), expiresAt),
        )
    }

    /** Never throws; used for every request that resolves an Actor. */
    fun hasValidSession(request: HttpServletRequest): Boolean = try {
        val token = tokenOf(request)
        if (token == null) {
            false
        } else {
            val hash = ParentSessionCookie.hash(token)
            val now = clock.instant()
            val row = find(hash)
            val valid = row != null && ParentSessionRules.isValid(now, row.lastSeenAt, row.expiresAt, row.idleSeconds)
            if (valid && ParentSessionRules.shouldTouch(now, row!!.lastSeenAt)) setLastSeen(hash, now)
            valid
        }
    } catch (e: Exception) {
        log.debug("parent session check failed", e)
        false
    }

    /** Describes the (already validated) session of the request. */
    fun describe(request: HttpServletRequest): ParentSessionDto = toDto(requireRow(request))

    fun touch(request: HttpServletRequest): ParentSessionDto {
        val hash = hashOf(request)
        setLastSeen(hash, clock.instant())
        return toDto(requireRow(request))
    }

    fun end(request: HttpServletRequest): ResponseCookie {
        tokenOf(request)?.let { jdbc.sql("DELETE FROM parent_session WHERE token_hash = ?").param(ParentSessionCookie.hash(it)).update() }
        log.info("parent session ended")
        return clearCookie()
    }

    fun clearCookie(): ResponseCookie = ParentSessionCookies.clear(props.parentSession)

    fun currentTokenHash(request: HttpServletRequest): ByteArray = hashOf(request)

    private fun toDto(row: Row) = ParentSessionDto(
        row.idleSeconds,
        row.lastSeenAt.plusSeconds(row.idleSeconds.toLong()),
        row.expiresAt,
    )

    private fun requireRow(request: HttpServletRequest): Row =
        find(hashOf(request)) ?: throw com.stickerbank.common.DomainException(com.stickerbank.common.ErrorCode.PARENT_SESSION_REQUIRED)

    private fun hashOf(request: HttpServletRequest): ByteArray = ParentSessionCookie.hash(
        tokenOf(request) ?: throw com.stickerbank.common.DomainException(com.stickerbank.common.ErrorCode.PARENT_SESSION_REQUIRED),
    )

    private fun tokenOf(request: HttpServletRequest): String? =
        request.cookies?.firstOrNull { it.name == ParentSessionCookie.NAME }?.value?.takeIf { it.isNotEmpty() }

    private fun find(hash: ByteArray): Row? = jdbc.sql(
        """
        SELECT s.last_seen_at, s.expires_at, f.parent_idle_timeout_sec
          FROM parent_session s CROSS JOIN family_settings f
         WHERE s.token_hash = ? AND f.id = 1
        """.trimIndent(),
    ).param(hash).query { rs, _ ->
        Row(
            utc(rs.getObject("last_seen_at", LocalDateTime::class.java)),
            utc(rs.getObject("expires_at", LocalDateTime::class.java)),
            rs.getInt("parent_idle_timeout_sec"),
        )
    }.optional().orElse(null)

    private fun setLastSeen(hash: ByteArray, now: Instant) {
        jdbc.sql("UPDATE parent_session SET last_seen_at = ? WHERE token_hash = ?").params(utc(now), hash).update()
    }

    private fun idleTimeoutSeconds(): Int =
        jdbc.sql("SELECT parent_idle_timeout_sec FROM family_settings WHERE id = 1").query(Int::class.java).single()
}

/** The bean other modules (via common's ActorArgumentResolver) see as [ParentSessionReader]. */
@Component
class JdbcParentSessionReader(private val sessions: ParentSessionService) : ParentSessionReader {
    override fun hasValidSession(request: HttpServletRequest): Boolean = sessions.hasValidSession(request)
}
