package com.stickerbank.flows

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.mysql.MySQLContainer
import org.testcontainers.utility.DockerImageName

/** V6 over a V5 database that already holds data (TDD 6.9, 13). Uses its own throwaway MySQL container. */
@Testcontainers(disabledWithoutDocker = true)
class MigrationV6DataIT {
    private data class StickerRow(
        val id: Long,
        val source: String,
        val routineId: Long?,
        val status: String,
        val finishMode: String?,
        val isLive: Int?,
    )

    @Test
    fun `V6 keeps existing stickers and their source, gives them no chore, and lets a chore earn one live sticker`() {
        MySQLContainer(DockerImageName.parse("mysql:8.4")).use { mysql ->
            mysql.start()
            val dataSource = DriverManagerDataSource(mysql.jdbcUrl, mysql.username, mysql.password)
            fun flyway(target: String) = Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target(target).load()
            flyway("5").migrate()
            val jdbc = JdbcClient.create(dataSource)
            fun count(sql: String) = jdbc.sql(sql).query(Long::class.java).single()
            fun stickers() = jdbc.sql("SELECT id, source, routine_id, status, finish_mode, is_live FROM sticker ORDER BY id").query {
                    rs,
                    _,
                ->
                StickerRow(
                    rs.getLong("id"),
                    rs.getString("source"),
                    (rs.getObject("routine_id") as Number?)?.toLong(),
                    rs.getString("status"),
                    rs.getString("finish_mode"),
                    (rs.getObject("is_live") as Number?)?.toInt(),
                )
            }.list()

            jdbc.sql(
                "INSERT INTO child (name, avatar_key, theme_color, position, created_at, updated_at, settled_through) " +
                    "VALUES ('Test User', 'cat-face', '#FFB703', 1, NOW(3), NOW(3), '2026-10-14')",
            ).update()
            val childId = jdbc.sql("SELECT id FROM child").query(Long::class.java).single()
            jdbc.sql("INSERT INTO routine (child_id, position, created_at) VALUES (?, 1, NOW(3))").param(childId).update()
            val routineId = jdbc.sql("SELECT id FROM routine").query(Long::class.java).single()
            val designs = jdbc.sql(
                "SELECT id FROM sticker_design WHERE is_fallback = FALSE ORDER BY id LIMIT 3",
            ).query(Long::class.java).list().map { requireNotNull(it) }
            val designId = designs.first()
            jdbc.sql(
                "INSERT INTO prize_request (child_id, status, created_by, created_at, updated_at) VALUES (?, 'PENDING', 'CHILD', NOW(3), NOW(3))",
            ).param(childId).update()
            val pendingId = jdbc.sql("SELECT id FROM prize_request").query(Long::class.java).single()

            // one routine sticker per V5 status on different days, the unclaimed one with saved choices
            listOf("UNCLAIMED", "AVAILABLE", "PENDING", "USED", "REVOKED").forEachIndexed { i, status ->
                val request = if (status == "PENDING") pendingId else null
                val design = if (status == "UNCLAIMED") null else designId
                jdbc.sql(
                    "INSERT INTO sticker (child_id, source, routine_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
                        "prize_request_id, earned_at, finish_mode) VALUES (?, 'ROUTINE', ?, DATE_SUB('2026-10-15', INTERVAL ? DAY), " +
                        "'Morning Routine', 'sun', ?, ?, ?, NOW(3), ?)",
                ).params(listOf<Any?>(childId, routineId, i, design, status, request, if (i % 2 == 0) "TAPPED" else "AUTO")).update()
            }
            val unclaimedId = jdbc.sql("SELECT id FROM sticker WHERE status = 'UNCLAIMED'").query(Long::class.java).single()
            designs.forEachIndexed { i, d ->
                jdbc.sql(
                    "INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)",
                ).params(unclaimedId, i + 1, d).update()
            }
            // a bonus sticker has no routine
            jdbc.sql(
                "INSERT INTO sticker (child_id, source, chart_date, design_id, status, earned_at) " +
                    "VALUES (?, 'BONUS', '2026-10-15', ?, 'AVAILABLE', NOW(3))",
            ).params(childId, designId).update()
            val before = stickers()
            assertThat(before).hasSize(6)
            assertThat(before.map { it.source }).containsExactly("ROUTINE", "ROUTINE", "ROUTINE", "ROUTINE", "ROUTINE", "BONUS")

            flyway("6").migrate()

            // every row is as it was: same source, routine, status, finish mode and liveness
            assertThat(stickers()).isEqualTo(before)
            assertThat(count("SELECT COUNT(*) FROM sticker WHERE chore_id IS NOT NULL")).isZero()
            assertThat(count("SELECT COUNT(*) FROM live_sticker")).isEqualTo(5)
            assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE chore_id IS NULL")).isEqualTo(5)
            assertThat(count("SELECT COUNT(*) FROM sticker_pick_choice")).isEqualTo(3)
            assertThat(count("SELECT COUNT(*) FROM child WHERE settled_through = '2026-10-14'")).isEqualTo(1)
            assertThat(count("SELECT COUNT(*) FROM chore")).isZero()
            assertThat(count("SELECT COUNT(*) FROM chore_task")).isZero()

            // the routine key still refuses a second live sticker for a routine day
            assertThatThrownBy {
                jdbc.sql(
                    "INSERT INTO sticker (child_id, source, routine_id, chart_date, status, earned_at) " +
                        "VALUES (?, 'ROUTINE', ?, '2026-10-15', 'UNCLAIMED', NOW(3))",
                ).params(childId, routineId).update()
            }.isInstanceOf(DuplicateKeyException::class.java)

            // a chore can now earn: one live sticker, any number of revoked ones beside it (BR-20)
            jdbc.sql(
                "INSERT INTO chore (child_id, name, icon_key, due_date, created_at, updated_at) " +
                    "VALUES (?, 'Tidy the playroom', 'broom', NULL, NOW(3), NOW(3))",
            ).param(childId).update()
            val choreId = jdbc.sql("SELECT id FROM chore").query(Long::class.java).single()
            jdbc.sql(
                "INSERT INTO chore_task (chore_id, position, label, icon_key, checked_at, checked_by) " +
                    "VALUES (?, 1, 'Blocks in the box', 'basket', NOW(3), 'CHILD')",
            ).param(choreId).update()
            val choreSticker =
                "INSERT INTO sticker (child_id, source, chore_id, chart_date, routine_name, routine_icon_key, status, earned_at) " +
                    "VALUES (?, 'CHORE', ?, ?, 'Tidy the playroom', 'broom', ?, NOW(3))"
            jdbc.sql(choreSticker).params(childId, choreId, "2026-10-15", "REVOKED").update()
            jdbc.sql(choreSticker).params(childId, choreId, "2026-10-15", "REVOKED").update()
            jdbc.sql(choreSticker).params(childId, choreId, "2026-10-15", "UNCLAIMED").update()
            assertThatThrownBy { jdbc.sql(choreSticker).params(childId, choreId, "2026-10-16", "UNCLAIMED").update() }
                .isInstanceOf(DuplicateKeyException::class.java)
            assertThat(count("SELECT COUNT(*) FROM live_sticker WHERE chore_id IS NOT NULL")).isEqualTo(1)
            assertThat(count("SELECT COUNT(*) FROM live_sticker")).isEqualTo(6)

            // chores, their tasks and their stickers go with the child
            jdbc.sql("DELETE FROM child WHERE id = ?").param(childId).update()
            assertThat(count("SELECT COUNT(*) FROM chore")).isZero()
            assertThat(count("SELECT COUNT(*) FROM chore_task")).isZero()
            assertThat(count("SELECT COUNT(*) FROM sticker")).isZero()
        }
    }
}
