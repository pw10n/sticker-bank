package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

@IntegrationTest
class MigrationFlowIT : FlowTestBase() {
    @Test
    fun `flyway applied V1 to V5 on an empty MySQL`() {
        val versions =
            jdbc.sql("SELECT version FROM flyway_schema_history WHERE success = TRUE AND version IS NOT NULL ORDER BY installed_rank")
                .query(String::class.java).list()
        assertThat(versions).containsExactly("1", "2", "3", "4", "5")
    }

    @Test
    fun `V5 adds the finish columns and the live view exposes them`() {
        val columns = { table: String ->
            jdbc.sql("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?")
                .param(table).query(String::class.java).list()
        }
        assertThat(columns("sticker")).contains("finish_mode")
        assertThat(columns("child")).contains("settled_through")
        // a SELECT * view is expanded when created, so V5 has to redefine it (TDD 6.8)
        assertThat(columns("live_sticker")).contains("finish_mode")
    }

    @Test
    fun `admin reset procedure exists`() {
        val rows = jdbc.sql("SHOW PROCEDURE STATUS WHERE Name = 'reset_parent_pin'").query().listOfRows()
        assertThat(rows).hasSize(1)
    }

    @Test
    fun `seeded library has 24 designs plus the fallback`() {
        assertThat(count("SELECT COUNT(*) FROM sticker_design WHERE is_fallback = FALSE")).isEqualTo(24)
        assertThat(count("SELECT COUNT(*) FROM sticker_design WHERE is_fallback = TRUE")).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker_design")).isEqualTo(25)
        assertThat(count("SELECT COUNT(*) FROM sticker_design WHERE is_fallback = FALSE AND status = 'ACTIVE'")).isEqualTo(24)
    }
}
