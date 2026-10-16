package com.stickerbank.dev

import com.stickerbank.common.Weekdays
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import java.time.Clock
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Random

/** Loads synthetic demo data for local development (`./gradlew bootTestRun`). SQL only, no-op when children exist. */
@TestConfiguration(proxyBeanMethods = false)
class DemoDataSeeder {
    @Bean
    fun demoDataLoader(jdbc: JdbcClient, clock: Clock): ApplicationRunner = ApplicationRunner { load(jdbc, clock) }

    companion object {
        /** Seeds the demo family; returns false (and does nothing) when children already exist. */
        fun load(jdbc: JdbcClient, clock: Clock): Boolean {
            if (jdbc.sql("SELECT COUNT(*) FROM child").query(Int::class.java).single() > 0) return false
            DemoSeedRun(jdbc, clock).run()
            return true
        }
    }
}

private class DemoSeedRun(private val jdbc: JdbcClient, private val clock: Clock) {
    private val log = LoggerFactory.getLogger(DemoDataSeeder::class.java)
    private val zone: ZoneId = ZoneId.of(System.getenv("DEMO_TIME_ZONE")?.takeIf { it.isNotBlank() } ?: "UTC")
    private val today: LocalDate = LocalDate.now(clock.withZone(zone))
    private val nowUtc: LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)
    private val random = Random(7)

    private class TaskSeed(val id: Long, val label: String, val icon: String)

    private class RoutineSeed(
        val id: Long,
        val name: String,
        val icon: String,
        val mask: Int,
        val tasks: List<TaskSeed>,
        val evening: Boolean,
    )

    private class StickerSeed(val id: Long, val chartDate: LocalDate)

    private fun insert(sql: String, vararg params: Any?): Long {
        val keys = GeneratedKeyHolder()
        jdbc.sql(sql).params(params.toList()).update(keys)
        return requireNotNull(keys.key).toLong()
    }

    /** Local date and time to a UTC timestamp, never later than now. */
    private fun utc(date: LocalDate, time: LocalTime): LocalDateTime =
        minOf(date.atTime(time).atZone(zone).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime(), nowUtc)

    fun run() {
        val pinHash = requireNotNull(BCryptPasswordEncoder(12).encode("1234"))
        jdbc.sql("UPDATE family_settings SET pin_hash = ?, pin_set_at = ?, time_zone = ?, updated_at = ? WHERE id = 1")
            .params(pinHash, nowUtc, zone.id, nowUtc).update()

        val designs =
            jdbc.sql(
                """
                SELECT d.id FROM sticker_design d LEFT JOIN sticker_category c ON c.id = d.category_id
                 WHERE d.status = 'ACTIVE' AND d.is_fallback = FALSE AND (d.category_id IS NULL OR c.enabled = TRUE)
                 ORDER BY d.id
                """.trimIndent(),
            ).query(Long::class.java).list().map { requireNotNull(it) }
        check(designs.size >= 3) { "Sticker library must have at least 3 active designs" }

        val jane = createChild("Jane Doe", "cat-face", "#FFB703", 1)
        val john = createChild("John Doe", "dog-face", "#4CC9F0", 2)
        seedChild(jane, designs, isJane = true)
        seedChild(john, designs, isJane = false)
        log.info("Demo data loaded — demo PIN 1234 (development only)")
    }

    private fun createChild(name: String, avatar: String, color: String, position: Int): Long = insert(
        "INSERT INTO child (name, avatar_key, theme_color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        name,
        avatar,
        color,
        position,
        nowUtc,
        nowUtc,
    )

    private fun createRoutine(
        childId: Long,
        position: Int,
        name: String,
        icon: String,
        color: String,
        mask: Int,
        tasks: List<Pair<String, String>>,
        evening: Boolean,
    ): RoutineSeed {
        val created = utc(today.minusDays(21), LocalTime.of(9, 0))
        val routineId = insert("INSERT INTO routine (child_id, position, created_at) VALUES (?, ?, ?)", childId, position, created)
        val revisionId =
            insert(
                "INSERT INTO routine_revision (routine_id, effective_from, name, icon_key, color, days_mask, paused, deleted, " +
                    "updated_at) VALUES (?, ?, ?, ?, ?, ?, FALSE, FALSE, ?)",
                routineId,
                today.minusDays(21),
                name,
                icon,
                color,
                mask,
                created,
            )
        val seeds =
            tasks.mapIndexed { index, (label, taskIcon) ->
                val taskId = insert("INSERT INTO task (routine_id, created_at) VALUES (?, ?)", routineId, created)
                jdbc.sql("INSERT INTO revision_task (revision_id, task_id, position, label, icon_key) VALUES (?, ?, ?, ?, ?)")
                    .params(revisionId, taskId, index + 1, label, taskIcon).update()
                TaskSeed(taskId, label, taskIcon)
            }
        return RoutineSeed(routineId, name, icon, mask, seeds, evening)
    }

    private fun complete(childId: Long, routine: RoutineSeed, task: TaskSeed, index: Int, date: LocalDate) {
        val time = (if (routine.evening) LocalTime.of(18, 30) else LocalTime.of(7, 0)).plusMinutes(index * 5L)
        jdbc.sql(
            "INSERT INTO task_completion (task_id, chart_date, routine_id, child_id, completed_at, completed_by) " +
                "VALUES (?, ?, ?, ?, ?, 'CHILD')",
        ).params(task.id, date, routine.id, childId, utc(date, time)).update()
    }

    private fun seedChild(childId: Long, designs: List<Long>, isJane: Boolean) {
        val morning =
            createRoutine(
                childId,
                1,
                "Morning Routine",
                "sun",
                "#FFB703",
                0b0011111,
                listOf(
                    "Brush teeth" to "toothbrush",
                    "Get dressed" to "t-shirt",
                    "Eat breakfast" to "bowl-with-spoon",
                    "Shoes on" to "sneaker",
                ),
                evening = false,
            )
        val bedtime =
            createRoutine(
                childId,
                2,
                "Bedtime",
                "crescent-moon",
                "#B388EB",
                Weekdays.ALL,
                listOf("Bath time" to "bathtub", "Pajamas on" to "bed", "Brush teeth" to "toothbrush", "Story time" to "open-book"),
                evening = true,
            )

        val stickers = mutableListOf<StickerSeed>()
        var unclaimedId: Long? = null
        for (offset in 14 downTo 1) {
            val date = today.minusDays(offset.toLong())
            for (routine in listOf(morning, bedtime)) {
                if (!Weekdays.includes(routine.mask, date)) continue
                val roll = random.nextDouble()
                val forceFull = routine === bedtime && ((isJane && offset >= 7) || (!isJane && offset == 1))
                when {
                    forceFull || roll < 0.7 -> {
                        routine.tasks.forEachIndexed { i, task -> complete(childId, routine, task, i, date) }
                        if (!isJane && routine === bedtime && offset == 1) {
                            // The child never tapped I'm Done!, so the day's end earned it (FR-6.10): it waits in the tray.
                            unclaimedId = insertSticker(childId, routine, date, "UNCLAIMED", null, null, finishMode = "AUTO")
                            val picks = designs.shuffled(random).take(3)
                            picks.forEachIndexed { i, designId ->
                                jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)")
                                    .params(unclaimedId, i + 1, designId).update()
                            }
                        } else {
                            val id = insertSticker(childId, routine, date, "AVAILABLE", designs[random.nextInt(designs.size)], null)
                            stickers += StickerSeed(id, date)
                        }
                    }
                    roll < 0.9 -> {
                        val done = 1 + random.nextInt(routine.tasks.size - 1)
                        routine.tasks.shuffled(random).take(done).forEachIndexed { i, task -> complete(childId, routine, task, i, date) }
                    }
                    else ->
                        jdbc.sql("INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, ?)")
                            .params(routine.id, date, utc(date, LocalTime.of(12, 0))).update()
                }
            }
        }

        if (isJane) {
            val ordered = stickers.sortedWith(compareBy({ it.chartDate }, { it.id }))
            check(ordered.size >= 8) { "Expected at least 8 demo stickers for the first child" }
            val used = ordered.take(5)
            val pending = ordered.drop(5).take(3)
            val completedAt = nowUtc.minusDays(2)
            val completedRequest = insertRequest(childId, "COMPLETED", "Trip to the playground", "PARENT", nowUtc.minusDays(3), completedAt)
            linkStickers(completedRequest, used, "USED")
            val pendingRequest = insertRequest(childId, "PENDING", null, "CHILD", nowUtc.minusDays(1), null)
            linkStickers(pendingRequest, pending, "PENDING")
            val live = if (Weekdays.includes(morning.mask, today)) morning else bedtime
            live.tasks.take(2).forEachIndexed { i, task -> complete(childId, live, task, i, today) }
        } else {
            // Every task is done but I'm Done! has not been tapped: the routine is Ready to finish and has no sticker (FR-6.6).
            val live = if (Weekdays.includes(morning.mask, today)) morning else bedtime
            live.tasks.forEachIndexed { i, task -> complete(childId, live, task, i, today) }
        }
        check(isJane || unclaimedId != null) { "Expected an unclaimed demo sticker" }
    }

    private fun insertSticker(
        childId: Long,
        routine: RoutineSeed,
        date: LocalDate,
        status: String,
        designId: Long?,
        requestId: Long?,
        finishMode: String = "TAPPED",
    ): Long {
        // an automatic finish is earned at the end of its day (TDD 7.12); a tapped one when the child tapped I'm Done!
        val earned =
            if (finishMode == "AUTO") {
                utc(date.plusDays(1), LocalTime.MIDNIGHT)
            } else {
                utc(date, if (routine.evening) LocalTime.of(18, 45) else LocalTime.of(7, 30))
            }
        return insert(
            "INSERT INTO sticker (child_id, source, routine_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
                "prize_request_id, earned_at, claimed_at, finish_mode) VALUES (?, 'ROUTINE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            childId, routine.id, date, routine.name, routine.icon, designId, status, requestId, earned,
            if (designId != null) earned.plus(Duration.ofMinutes(1)) else null, finishMode,
        )
    }

    private fun insertRequest(
        childId: Long,
        status: String,
        prize: String?,
        createdBy: String,
        createdAt: LocalDateTime,
        completedAt: LocalDateTime?,
    ): Long = insert(
        "INSERT INTO prize_request (child_id, status, created_by, prize_text, created_at, completed_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        childId,
        status,
        createdBy,
        prize,
        createdAt,
        completedAt,
        completedAt ?: createdAt,
    )

    private fun linkStickers(requestId: Long, stickers: List<StickerSeed>, status: String) {
        stickers.forEach { s ->
            jdbc.sql("UPDATE sticker SET status = ?, prize_request_id = ? WHERE id = ?").params(status, requestId, s.id).update()
            jdbc.sql("INSERT INTO prize_request_item (prize_request_id, sticker_id) VALUES (?, ?)").params(requestId, s.id).update()
        }
    }
}
