package com.stickerbank.family

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.StickerBankProperties
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.max

fun requireIanaZone(field: String, timeZone: String) {
    if (!ZoneId.getAvailableZoneIds().contains(timeZone) || !timeZone.contains('/') && timeZone != "UTC") {
        throw DomainException(
            ErrorCode.VALIDATION_FAILED,
            properties = mapOf("fieldErrors" to listOf(FieldErrorDto(field, "Choose a valid time zone"))),
        )
    }
}

@Service
class PinService(
    private val jdbc: JdbcClient,
    private val clock: Clock,
    props: StickerBankProperties,
    txManager: PlatformTransactionManager,
    private val sessions: ParentSessionService,
) {
    private val log = LoggerFactory.getLogger(PinService::class.java)
    private val encoder = BCryptPasswordEncoder(12)
    private val tx = TransactionTemplate(txManager)
    private val policy = PinLockoutPolicy(props.pin.attemptsBeforeLockout, props.pin.cooldowns)

    private sealed interface Result {
        data object Success : Result

        data object NotSet : Result

        data class Locked(val retryAfter: Duration) : Result

        data class Incorrect(val attemptsRemaining: Int, val retryAfter: Duration?) : Result
    }

    private data class SettingsRow(val pinHash: String?, val failed: Int, val level: Int, val lockedUntil: LocalDateTime?)

    fun setup(request: PinSetupRequest): StartedSession {
        requireIanaZone("timeZone", request.timeZone)
        val now = utc(clock.instant())
        val updated = jdbc.sql(
            """
            UPDATE family_settings
               SET pin_hash = ?, pin_set_at = ?, time_zone = ?, failed_pin_attempts = 0, lockout_level = 0,
                   pin_locked_until = NULL, updated_at = ?
             WHERE id = 1 AND pin_hash IS NULL
            """.trimIndent(),
        ).params(listOf(encoder.encode(request.pin), now, request.timeZone, now)).update()
        if (updated == 0) throw DomainException(ErrorCode.PIN_ALREADY_SET)
        log.info("PIN set")
        return sessions.start()
    }

    fun unlock(pin: String): StartedSession {
        throwUnlessSuccess(attempt(pin) {})
        return sessions.start()
    }

    fun change(currentPin: String, newPin: String, request: HttpServletRequest) {
        val keep = sessions.currentTokenHash(request)
        val result = attempt(currentPin) {
            val now = utc(clock.instant())
            jdbc.sql("UPDATE family_settings SET pin_hash = ?, pin_set_at = ?, updated_at = ? WHERE id = 1")
                .params(listOf(encoder.encode(newPin), now, now)).update()
            jdbc.sql("DELETE FROM parent_session WHERE token_hash <> ?").param(keep).update()
        }
        throwUnlessSuccess(result)
        log.info("PIN changed")
    }

    /** Runs the lockout logic in one transaction that always commits; any error is thrown by the caller afterwards. */
    private fun attempt(pin: String, onSuccess: () -> Unit): Result = tx.execute {
        val now = utc(clock.instant())
        val row = jdbc.sql(
            "SELECT pin_hash, failed_pin_attempts, lockout_level, pin_locked_until FROM family_settings WHERE id = 1 FOR UPDATE",
        ).query { rs, _ ->
            SettingsRow(
                rs.getString("pin_hash"),
                rs.getInt("failed_pin_attempts"),
                rs.getInt("lockout_level"),
                rs.getObject("pin_locked_until", LocalDateTime::class.java),
            )
        }.single()
        val hash = row.pinHash
        val lockedUntil = row.lockedUntil
        when {
            hash == null -> Result.NotSet
            lockedUntil != null && lockedUntil.isAfter(now) -> Result.Locked(remaining(now, lockedUntil))
            encoder.matches(pin, hash) -> {
                jdbc.sql("UPDATE family_settings SET failed_pin_attempts = 0, lockout_level = 0, pin_locked_until = NULL WHERE id = 1")
                    .update()
                onSuccess()
                Result.Success
            }
            else -> {
                val failure = policy.onFailure(row.failed, row.level)
                val until = failure.lockFor?.let { now.plus(it) }
                jdbc.sql(
                    "UPDATE family_settings SET failed_pin_attempts = ?, lockout_level = ?, pin_locked_until = ?, updated_at = ? WHERE id = 1",
                ).params(listOf(failure.failedAttempts, failure.lockoutLevel, until, now)).update()
                if (until != null) log.info("PIN lockout until {}", until)
                Result.Incorrect(failure.attemptsRemaining, failure.lockFor?.let { max(1, it.seconds).let(Duration::ofSeconds) })
            }
        }
    }!!

    private fun remaining(now: LocalDateTime, until: LocalDateTime): Duration {
        val millis = Duration.between(now, until).toMillis()
        return Duration.ofSeconds(max(1L, (millis + 999) / 1000))
    }

    private fun throwUnlessSuccess(result: Result) {
        when (result) {
            Result.Success -> Unit
            Result.NotSet -> throw DomainException(ErrorCode.PIN_NOT_SET)
            is Result.Locked ->
                throw DomainException(ErrorCode.PIN_LOCKED, properties = mapOf("retryAfterSeconds" to result.retryAfter.seconds))
            is Result.Incorrect -> {
                val props = mutableMapOf<String, Any?>("attemptsRemaining" to result.attemptsRemaining)
                result.retryAfter?.let { props["retryAfterSeconds"] = it.seconds }
                throw DomainException(ErrorCode.PIN_INCORRECT, properties = props)
            }
        }
    }
}
