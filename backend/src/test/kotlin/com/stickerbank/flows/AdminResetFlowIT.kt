package com.stickerbank.flows

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@IntegrationTest
class AdminResetFlowIT : FlowTestBase() {
    @Test
    fun `admin PIN reset locks parent mode out and keeps family data (FR-8-9, FR-8-10)`() {
        val oldSession = setupParent("1234")
        val childId = createChildViaApi(oldSession, "Jane Doe")
        val routine = fixtures.createRoutine(childId)
        fixtures.createSticker(
            childId,
            routine.routineId,
            LocalDate.of(2026, 10, 14),
            StickerStatus.AVAILABLE,
            fixtures.activeDesignIds().first(),
        )
        fetch("/api/parent/settings", oldSession).andExpect(status().isOk)
            .andExpect(jsonPath("$.lastPinReset").doesNotExist())

        jdbc.sql("CALL reset_parent_pin('Test Admin')").update()

        fetch("/api/parent/settings", oldSession).andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("PARENT_SESSION_REQUIRED"))
        fetch("/api/bootstrap").andExpect(jsonPath("$.setupRequired").value(true))

        val newSession = setupParent("5678")
        fetch("/api/parent/settings", newSession).andExpect(status().isOk)
            .andExpect(jsonPath("$.lastPinReset.adminName").value("Test Admin"))
            .andExpect(jsonPath("$.pinSetAt").isNotEmpty)

        assertThat(count("SELECT COUNT(*) FROM child")).isEqualTo(1)
        assertThat(count("SELECT COUNT(*) FROM sticker WHERE child_id = ?", childId)).isEqualTo(1)
        fetch("/api/parent/children", newSession).andExpect(jsonPath("$[0].name").value("Jane Doe"))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.counts.available").value(1))
    }
}
