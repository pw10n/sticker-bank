package com.stickerbank.prize

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

@IntegrationTest
class PrizeRevokedIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var clock: MutableClock

    private var token = ""
    private var childId = 0L
    private var routineId = 0L
    private var designId = 0L
    private var day = 0L

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
        fixtures.setPin()
        token = fixtures.createParentSession()
        childId = fixtures.createChild("Jane Doe")
        routineId = fixtures.createRoutine(childId).routineId
        designId = fixtures.activeDesignIds().first()
    }

    private fun sticker(status: StickerStatus = StickerStatus.AVAILABLE): Long =
        fixtures.createSticker(childId, routineId, LocalDate.of(2026, 9, 1).plusDays(day++), status, designId)

    private fun stickerStatus(id: Long) = jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(id).query(String::class.java).single()

    private fun create(ids: List<Long>) = mvc.perform(
        post("/api/children/$childId/prize-requests").header("X-Sticker-Bank", "1")
            .contentType(MediaType.APPLICATION_JSON).content("""{"stickerIds":${ids.joinToString(prefix = "[", postfix = "]")}}"""),
    )

    /** Request with three PENDING stickers, one of which is then revoked (mirrors TDD 7.11 step 6 without detaching the item). */
    private fun requestWithOneRevoked(): Triple<Long, Long, List<Long>> {
        val ids = listOf(sticker(), sticker(), sticker())
        create(ids).andExpect(status().isCreated)
        val rid = jdbc.sql("SELECT id FROM prize_request").query(Long::class.java).single()
        jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(ids[0]).update()
        return Triple(rid, ids[0], ids)
    }

    @Test
    fun `create with a revoked sticker is 409 STICKER_NOT_AVAILABLE`() {
        create(listOf(sticker(StickerStatus.REVOKED))).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("STICKER_NOT_AVAILABLE"))
    }

    @Test
    fun `request counts only non revoked stickers but lists all with revoked flag`() {
        val (rid, _, _) = requestWithOneRevoked()
        mvc.perform(get("/api/children/$childId/prize-requests/pending")).andExpect(status().isOk)
            .andExpect(jsonPath("$.request.id").value(rid))
            .andExpect(jsonPath("$.request.stickerCount").value(2))
            .andExpect(jsonPath("$.request.stickers.length()").value(3))
            .andExpect(jsonPath("$.request.stickers[?(@.revoked == true)]").value(org.hamcrest.Matchers.hasSize<Any>(1)))
        mvc.perform(get("/api/parent/prize-requests").cookie(fixtures.parentCookie(token))).andExpect(status().isOk)
            .andExpect(jsonPath("$.items[0].stickerCount").value(2))
            .andExpect(jsonPath("$.items[0].stickers.length()").value(3))
    }

    @Test
    fun `complete marks only pending stickers used and leaves the revoked one`() {
        val (rid, revoked, ids) = requestWithOneRevoked()
        mvc.perform(
            post("/api/parent/prize-requests/$rid/complete").header("X-Sticker-Bank", "1").cookie(fixtures.parentCookie(token))
                .contentType(MediaType.APPLICATION_JSON).content("""{"prizeText":"Ice cream"}"""),
        ).andExpect(status().isOk).andExpect(jsonPath("$.stickerCount").value(2)).andExpect(jsonPath("$.stickers.length()").value(3))
        assertThat(stickerStatus(revoked)).isEqualTo("REVOKED")
        ids.drop(1).forEach { assertThat(stickerStatus(it)).isEqualTo("USED") }
    }

    @Test
    fun `cancel reason passes through ALL_STICKERS_REVOKED and normal cancel is CANCELLED`() {
        val a = sticker()
        create(listOf(a)).andExpect(status().isCreated)
        val first = jdbc.sql("SELECT id FROM prize_request").query(Long::class.java).single()
        jdbc.sql("UPDATE sticker SET status = 'REVOKED', prize_request_id = NULL WHERE id = ?").param(a).update()
        jdbc.sql(
            "UPDATE prize_request SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = 'PARENT', " +
                "cancel_reason = 'ALL_STICKERS_REVOKED' WHERE id = ?",
        )
            .params(java.time.LocalDateTime.of(2026, 10, 15, 15, 0), first).update()
        val b = sticker()
        create(listOf(b)).andExpect(status().isCreated)
        val second = jdbc.sql("SELECT id FROM prize_request WHERE status = 'PENDING'").query(Long::class.java).single()
        mvc.perform(post("/api/prize-requests/$second/cancel").header("X-Sticker-Bank", "1")).andExpect(status().isOk)
            .andExpect(jsonPath("$.cancelReason").value("CANCELLED"))
        mvc.perform(get("/api/parent/prize-requests?status=CANCELLED").cookie(fixtures.parentCookie(token))).andExpect(status().isOk)
            .andExpect(jsonPath("$.items[?(@.id == $first)].cancelReason").value("ALL_STICKERS_REVOKED"))
            .andExpect(jsonPath("$.items[?(@.id == $first)].stickerCount").value(0))
    }
}
