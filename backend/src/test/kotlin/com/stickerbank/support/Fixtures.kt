package com.stickerbank.support

import com.stickerbank.common.ParentSessionCookie
import com.stickerbank.common.StickerStatus
import com.stickerbank.common.Weekdays
import jakarta.servlet.http.Cookie
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import java.time.Clock
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

data class RoutineFixture(val routineId: Long, val revisionId: Long, val taskIds: List<Long>)

/** SQL-only test data helpers; synthetic data only, independent of feature code. */
class Fixtures(private val jdbc: JdbcClient, private val clock: Clock) {
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)

    private fun insert(sql: String, vararg params: Any?): Long {
        val keys = GeneratedKeyHolder()
        jdbc.sql(sql).params(params.toList()).update(keys)
        return requireNotNull(keys.key).toLong()
    }

    fun createChild(name: String = "Jane Doe", avatarKey: String = "cat-face", themeColor: String = "#FFB703"): Long {
        val position = jdbc.sql("SELECT COALESCE(MAX(position), 0) + 1 FROM child").query(Int::class.java).single()
        val now = now()
        return insert(
            "INSERT INTO child (name, avatar_key, theme_color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            name,
            avatarKey,
            themeColor,
            position,
            now,
            now,
        )
    }

    fun createRoutine(
        childId: Long,
        name: String = "Morning Routine",
        iconKey: String = "sun",
        tasks: List<Pair<String, String>> = listOf("Brush teeth" to "toothbrush", "Get dressed" to "t-shirt"),
        daysMask: Int = Weekdays.ALL,
        effectiveFrom: LocalDate = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC).minusDays(30),
        paused: Boolean = false,
    ): RoutineFixture {
        val now = now()
        val position =
            jdbc.sql("SELECT COALESCE(MAX(position), 0) + 1 FROM routine WHERE child_id = ?")
                .param(childId).query(Int::class.java).single()
        val routineId =
            insert("INSERT INTO routine (child_id, position, created_at) VALUES (?, ?, ?)", childId, position, now)
        val revisionId =
            insert(
                "INSERT INTO routine_revision (routine_id, effective_from, name, icon_key, " +
                    "color, days_mask, paused, deleted, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, FALSE, ?)",
                routineId,
                effectiveFrom,
                name,
                iconKey,
                daysMask,
                paused,
                now,
            )
        val taskIds =
            tasks.mapIndexed { index, (label, icon) ->
                val taskId = insert("INSERT INTO task (routine_id, created_at) VALUES (?, ?)", routineId, now)
                jdbc.sql("INSERT INTO revision_task (revision_id, task_id, position, label, icon_key) VALUES (?, ?, ?, ?, ?)")
                    .params(revisionId, taskId, index + 1, label, icon).update()
                taskId
            }
        return RoutineFixture(routineId, revisionId, taskIds)
    }

    fun completeTask(childId: Long, routineId: Long, taskId: Long, date: LocalDate, by: String = "CHILD") {
        jdbc.sql(
            "INSERT INTO task_completion (task_id, chart_date, routine_id, child_id, completed_at, completed_by) VALUES (?, ?, ?, ?, ?, ?)",
        ).params(taskId, date, routineId, childId, now(), by).update()
    }

    fun createSticker(
        childId: Long,
        routineId: Long?,
        chartDate: LocalDate,
        status: StickerStatus,
        designId: Long?,
        prizeRequestId: Long? = null,
        routineName: String? = "Morning Routine",
        routineIconKey: String? = "sun",
    ): Long {
        val now = now()
        return insert(
            "INSERT INTO sticker (child_id, source, routine_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
                "prize_request_id, earned_at, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            childId, if (routineId == null) "BONUS" else "ROUTINE", routineId, chartDate, routineName, routineIconKey,
            designId, status.name, prizeRequestId, now, if (designId != null) now else null,
        )
    }

    /** The pick pool: active, non-fallback designs that are uncategorised or in an enabled category. */
    fun activeDesignIds(): List<Long> = jdbc.sql(
        """
            SELECT d.id FROM sticker_design d
              LEFT JOIN sticker_category c ON c.id = d.category_id
             WHERE d.status = 'ACTIVE' AND d.is_fallback = FALSE AND (d.category_id IS NULL OR c.enabled = TRUE)
             ORDER BY d.id
        """.trimIndent(),
    ).query(Long::class.java).list().map { requireNotNull(it) }

    fun fallbackDesignId(): Long = jdbc.sql("SELECT id FROM sticker_design WHERE is_fallback = TRUE").query(Long::class.java).single()

    fun setPin(pin: String = "1234", timeZone: String = "UTC") {
        jdbc.sql(
            """
            UPDATE family_settings
               SET pin_hash = ?, pin_set_at = ?, failed_pin_attempts = 0, lockout_level = 0, pin_locked_until = NULL,
                   time_zone = ?, updated_at = ?
             WHERE id = 1
            """.trimIndent(),
        ).params(requireNotNull(BCryptPasswordEncoder(4).encode(pin)), now(), timeZone, now()).update()
    }

    /** Inserts a valid parent session and returns the raw cookie value. */
    fun createParentSession(): String {
        val token = ParentSessionCookie.newToken()
        val now = now()
        jdbc.sql("INSERT INTO parent_session (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)")
            .params(ParentSessionCookie.hash(token), now, now, now.plus(Duration.ofHours(12))).update()
        return token
    }

    fun parentCookie(token: String): Cookie = Cookie(ParentSessionCookie.NAME, token)
}
