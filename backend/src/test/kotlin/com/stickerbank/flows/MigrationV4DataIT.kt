package com.stickerbank.flows

import org.assertj.core.api.Assertions.assertThat
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.mysql.MySQLContainer
import org.testcontainers.utility.DockerImageName

/** V4 over a V3 database that already holds data (TDD 13). Uses its own throwaway MySQL container. */
@Testcontainers(disabledWithoutDocker = true)
class MigrationV4DataIT {
    @Test
    fun `V4 keeps existing rows, marks them live and backfills cancel reasons`() {
        MySQLContainer(DockerImageName.parse("mysql:8.4")).use { mysql ->
            mysql.start()
            val dataSource = DriverManagerDataSource(mysql.jdbcUrl, mysql.username, mysql.password)
            fun flyway(target: String) = Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target(target).load()
            flyway("3").migrate()
            val jdbc = JdbcClient.create(dataSource)
            fun reasons(id: Long) =
                jdbc.sql("SELECT cancel_reason FROM prize_request WHERE id = ?").param(id).query(String::class.java).list()

            jdbc.sql(
                "INSERT INTO child (name, avatar_key, theme_color, position, created_at, updated_at) " +
                    "VALUES ('Test User', 'cat-face', '#FFB703', 1, NOW(3), NOW(3))",
            ).update()
            val childId = jdbc.sql("SELECT id FROM child").query(Long::class.java).single()
            jdbc.sql("INSERT INTO routine (child_id, position, created_at) VALUES (?, 1, NOW(3))").param(childId).update()
            val routineId = jdbc.sql("SELECT id FROM routine").query(Long::class.java).single()
            val designId =
                jdbc.sql("SELECT id FROM sticker_design WHERE is_fallback = FALSE ORDER BY id LIMIT 1").query(Long::class.java).single()

            // a cancelled and a pending request
            jdbc.sql(
                "INSERT INTO prize_request (child_id, status, created_by, created_at, cancelled_at, cancelled_by, updated_at) " +
                    "VALUES (?, 'CANCELLED', 'CHILD', NOW(3), NOW(3), 'CHILD', NOW(3))",
            ).param(childId).update()
            jdbc.sql(
                "INSERT INTO prize_request (child_id, status, created_by, created_at, updated_at) " +
                    "VALUES (?, 'PENDING', 'PARENT', NOW(3), NOW(3))",
            ).param(childId).update()
            val cancelledId = jdbc.sql("SELECT id FROM prize_request WHERE status = 'CANCELLED'").query(Long::class.java).single()
            val pendingId = jdbc.sql("SELECT id FROM prize_request WHERE status = 'PENDING'").query(Long::class.java).single()

            // one sticker per V3 status on different days
            listOf("UNCLAIMED", "AVAILABLE", "PENDING", "USED").forEachIndexed { i, status ->
                val request = if (status == "PENDING") pendingId else null
                val design = if (status == "UNCLAIMED") null else designId
                jdbc.sql(
                    "INSERT INTO sticker (child_id, source, routine_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
                        "prize_request_id, earned_at) VALUES (?, 'ROUTINE', ?, DATE_SUB('2026-10-15', INTERVAL ? DAY), " +
                        "'Morning Routine', 'sun', ?, ?, ?, NOW(3))",
                ).params(listOf<Any?>(childId, routineId, i, design, status, request)).update()
            }
            // a bonus sticker has no routine
            jdbc.sql(
                "INSERT INTO sticker (child_id, source, chart_date, design_id, status, earned_at) " +
                    "VALUES (?, 'BONUS', '2026-10-15', ?, 'AVAILABLE', NOW(3))",
            ).params(childId, designId).update()
            val before = jdbc.sql("SELECT id, status FROM sticker ORDER BY id").query { rs, _ -> rs.getLong(1) to rs.getString(2) }.list()
            assertThat(before).hasSize(5)

            flyway("4").migrate()

            val after = jdbc.sql("SELECT id, status FROM sticker ORDER BY id").query { rs, _ -> rs.getLong(1) to rs.getString(2) }.list()
            assertThat(after).isEqualTo(before)
            assertThat(jdbc.sql("SELECT COUNT(*) FROM sticker WHERE is_live = 1").query(Long::class.java).single()).isEqualTo(5)
            assertThat(jdbc.sql("SELECT COUNT(*) FROM live_sticker").query(Long::class.java).single()).isEqualTo(5)
            assertThat(jdbc.sql("SELECT COUNT(*) FROM child").query(Long::class.java).single()).isEqualTo(1)
            assertThat(jdbc.sql("SELECT COUNT(*) FROM routine").query(Long::class.java).single()).isEqualTo(1)
            assertThat(reasons(cancelledId)).containsExactly("CANCELLED")
            assertThat(reasons(pendingId)).containsExactly(null)
            assertThat(jdbc.sql("SELECT COUNT(*) FROM sticker_revocation").query(Long::class.java).single()).isZero()

            // revoked rows may now share a routine day with a live row, a second live row may not
            val first = after.first().first
            jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(first).update()
            jdbc.sql(
                "INSERT INTO sticker (child_id, source, routine_id, chart_date, design_id, status, earned_at) " +
                    "SELECT child_id, source, routine_id, chart_date, design_id, 'AVAILABLE', earned_at FROM sticker WHERE id = ?",
            ).param(first).update()
            assertThat(jdbc.sql("SELECT COUNT(*) FROM live_sticker").query(Long::class.java).single()).isEqualTo(5)
        }
    }
}
