package com.stickerbank.child

import com.stickerbank.dev.DemoDataSeeder
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock

@IntegrationTest
@Import(DemoDataSeeder::class)
class DemoDataSeederIT {
    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: Clock

    // The MySQL container (@RestartScope) is shared across cached contexts, so earlier tests may have left rows behind.
    // Start from the freshly migrated state and seed explicitly; the ApplicationRunner is a no-op on a non-empty DB.
    @BeforeEach
    fun seedFreshDatabase() {
        dbCleaner.reset()
        assertThat(DemoDataSeeder.load(jdbc, clock)).isTrue()
    }

    private fun count(sql: String): Int = jdbc.sql(sql).query(Int::class.java).single()

    private fun zero(message: String, sql: String) = assertThat(count(sql)).describedAs(message).isZero()

    @Test
    fun `demo data satisfies all invariants`() {
        assertThat(count("SELECT COUNT(*) FROM child")).isEqualTo(2)
        assertThat(
            count("SELECT COUNT(*) FROM family_settings WHERE id = 1 AND pin_hash IS NOT NULL AND pin_set_at IS NOT NULL"),
        ).isEqualTo(1)
        listOf("AVAILABLE", "PENDING", "USED", "UNCLAIMED").forEach {
            assertThat(count("SELECT COUNT(*) FROM sticker WHERE status = '$it'")).describedAs(it).isGreaterThanOrEqualTo(1)
        }
        assertThat(count("SELECT COUNT(*) FROM prize_request WHERE status = 'PENDING'")).isEqualTo(1)

        zero(
            "items missing",
            "SELECT COUNT(*) FROM sticker s " +
                "WHERE s.prize_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prize_request_item i WHERE i.sticker_id = s.id AND i.prize_request_id = s.prize_request_id)",
        )
        zero(
            "items without stickers pointing back",
            "SELECT COUNT(*) FROM prize_request_item i JOIN sticker s ON s.id = i.sticker_id WHERE s.prize_request_id <> i.prize_request_id OR s.prize_request_id IS NULL",
        )
        zero(
            "pending sticker request",
            "SELECT COUNT(*) FROM sticker s LEFT JOIN prize_request r ON r.id = s.prize_request_id WHERE s.status = 'PENDING' AND (r.status IS NULL OR r.status <> 'PENDING')",
        )
        zero(
            "used sticker request",
            "SELECT COUNT(*) FROM sticker s LEFT JOIN prize_request r ON r.id = s.prize_request_id WHERE s.status = 'USED' AND (r.status IS NULL OR r.status <> 'COMPLETED')",
        )
        zero(
            "multiple pending",
            "SELECT COUNT(*) FROM (SELECT child_id FROM prize_request WHERE status = 'PENDING' GROUP BY child_id HAVING COUNT(*) > 1) x",
        )
        zero(
            "claimed fields",
            "SELECT COUNT(*) FROM sticker WHERE status IN ('AVAILABLE','PENDING','USED') AND (design_id IS NULL OR claimed_at IS NULL)",
        )
        zero(
            "unclaimed fields",
            "SELECT COUNT(*) FROM sticker WHERE status = 'UNCLAIMED' AND (design_id IS NOT NULL OR claimed_at IS NOT NULL)",
        )
        zero(
            "unclaimed choices",
            "SELECT COUNT(*) FROM sticker s WHERE s.status = 'UNCLAIMED' AND (SELECT COUNT(DISTINCT design_id) FROM sticker_pick_choice c WHERE c.sticker_id = s.id) NOT BETWEEN 1 AND 3",
        )
        zero(
            "choices on claimed",
            "SELECT COUNT(*) FROM sticker_pick_choice c JOIN sticker s ON s.id = c.sticker_id WHERE s.status <> 'UNCLAIMED'",
        )
        zero("inactive designs", "SELECT COUNT(*) FROM sticker s JOIN sticker_design d ON d.id = s.design_id WHERE d.status <> 'ACTIVE'")
        zero(
            "sticker on incomplete day",
            """
            SELECT COUNT(*) FROM sticker s WHERE s.routine_id IS NOT NULL AND
              (SELECT COUNT(*) FROM task_completion c WHERE c.routine_id = s.routine_id AND c.chart_date = s.chart_date) <>
              (SELECT COUNT(*) FROM revision_task rt JOIN routine_revision rr ON rr.id = rt.revision_id
                WHERE rr.routine_id = s.routine_id AND rr.effective_from <= s.chart_date)
            """.trimIndent(),
        )
        zero(
            "sticker on skipped day",
            "SELECT COUNT(*) FROM sticker s JOIN routine_skip k ON k.routine_id = s.routine_id AND k.chart_date = s.chart_date",
        )
        zero(
            "skipped day has completions",
            "SELECT COUNT(*) FROM routine_skip k JOIN task_completion c ON c.routine_id = k.routine_id AND c.chart_date = k.chart_date",
        )
        zero(
            "completion for task outside revision",
            "SELECT COUNT(*) FROM task_completion c WHERE NOT EXISTS (SELECT 1 FROM revision_task rt JOIN routine_revision rr ON rr.id = rt.revision_id WHERE rt.task_id = c.task_id AND rr.effective_from <= c.chart_date)",
        )
        zero(
            "duplicate routine days",
            "SELECT COUNT(*) FROM (SELECT routine_id, chart_date FROM sticker WHERE routine_id IS NOT NULL GROUP BY routine_id, chart_date HAVING COUNT(*) > 1) x",
        )
        zero("future dates", "SELECT COUNT(*) FROM sticker WHERE chart_date > UTC_DATE() + INTERVAL 1 DAY")
        zero("future completions", "SELECT COUNT(*) FROM task_completion WHERE chart_date > UTC_DATE() + INTERVAL 1 DAY")
        zero("snapshots", "SELECT COUNT(*) FROM sticker WHERE routine_name IS NULL OR routine_icon_key IS NULL")
    }
}
