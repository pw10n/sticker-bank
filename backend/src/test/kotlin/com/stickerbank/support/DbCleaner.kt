package com.stickerbank.support

import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator
import javax.sql.DataSource

/** Resets all application data to the freshly migrated state. Call from @BeforeEach in integration tests. */
class DbCleaner(private val jdbc: JdbcClient, private val dataSource: DataSource) {
    fun reset() {
        // child cascades routines, revisions, tasks, completions, stickers, choices and prize requests
        jdbc.sql("DELETE FROM child").update()
        jdbc.sql("DELETE FROM parent_session").update()
        jdbc.sql("DELETE FROM pin_reset_log").update()
        jdbc.sql("DELETE FROM sticker_design").update()
        jdbc.sql("DELETE FROM sticker_category").update()
        ResourceDatabasePopulator(ClassPathResource("db/migration/V2__seed_sticker_library.sql")).execute(dataSource)
        jdbc.sql(
            """
            UPDATE family_settings
               SET pin_hash = NULL, pin_set_at = NULL, failed_pin_attempts = 0, lockout_level = 0,
                   pin_locked_until = NULL, time_zone = 'UTC', parent_idle_timeout_sec = 300,
                   updated_at = UTC_TIMESTAMP(3)
             WHERE id = 1
            """.trimIndent(),
        ).update()
    }
}
