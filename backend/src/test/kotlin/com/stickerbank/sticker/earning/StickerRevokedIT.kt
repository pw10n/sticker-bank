package com.stickerbank.sticker.earning

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

@IntegrationTest
class StickerRevokedIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: MutableClock

    private var childId = 0L
    private var routineId = 0L
    private var designId = 0L
    private var day = 0L

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        childId = fixtures.createChild("Jane Doe")
        routineId = fixtures.createRoutine(childId).routineId
        designId = fixtures.activeDesignIds().first()
    }

    private fun sticker(status: StickerStatus, design: Long? = designId): Long =
        fixtures.createSticker(childId, routineId, LocalDate.of(2026, 9, 1).plusDays(day++), status, design)

    @Test
    fun `book items and counts exclude revoked stickers`() {
        sticker(StickerStatus.AVAILABLE)
        sticker(StickerStatus.PENDING)
        sticker(StickerStatus.USED)
        sticker(StickerStatus.UNCLAIMED, null)
        sticker(StickerStatus.REVOKED)
        mvc.perform(get("/api/children/$childId/stickers")).andExpect(status().isOk)
            .andExpect(jsonPath("$.items.length()").value(3))
            .andExpect(jsonPath("$.counts.available").value(1))
            .andExpect(jsonPath("$.counts.pending").value(1))
            .andExpect(jsonPath("$.counts.used").value(1))
            .andExpect(jsonPath("$.counts.totalEarned").value(3))
            .andExpect(jsonPath("$.counts.unclaimed").value(1))
    }

    @Test
    fun `book filter by REVOKED is a validation error`() {
        sticker(StickerStatus.REVOKED)
        mvc.perform(get("/api/children/$childId/stickers?status=REVOKED")).andExpect(status().isBadRequest)
    }

    @Test
    fun `claiming a revoked sticker is 409 STICKER_REVOKED`() {
        val id = sticker(StickerStatus.REVOKED)
        mvc.perform(
            post("/api/stickers/$id/pick").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON)
                .content("""{"designId": $designId}"""),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("STICKER_REVOKED"))
    }

    @Test
    fun `get pick of a revoked sticker returns REVOKED with no choices`() {
        val id = sticker(StickerStatus.REVOKED)
        mvc.perform(get("/api/stickers/$id/pick")).andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("REVOKED"))
            .andExpect(jsonPath("$.choices.length()").value(0))
            .andExpect(jsonPath("$.claimed.designId").value(designId))
    }

    @Test
    fun `detail of a revoked sticker has status REVOKED and no prize`() {
        val id = sticker(StickerStatus.REVOKED)
        mvc.perform(get("/api/stickers/$id")).andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("REVOKED"))
            .andExpect(jsonPath("$.prize").doesNotExist())
    }
}
