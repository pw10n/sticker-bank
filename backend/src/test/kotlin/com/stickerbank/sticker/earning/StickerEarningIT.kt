package com.stickerbank.sticker.earning

import com.stickerbank.common.ChildLock
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.common.StickerPickDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import com.stickerbank.support.MutableClock
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import tools.jackson.databind.json.JsonMapper
import java.time.LocalDate
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

@IntegrationTest
class StickerEarningIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var childLock: ChildLock

    @Autowired lateinit var earner: StickerEarner

    @Autowired lateinit var jdbc: JdbcClient

    @Autowired lateinit var clock: MutableClock

    private val date: LocalDate = LocalDate.parse("2026-10-14")
    private var childId = 0L
    private var routineId = 0L

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        childId = fixtures.createChild()
        routineId = fixtures.createRoutine(childId).routineId
    }

    private fun earn(day: LocalDate = date, routine: Long = routineId): StickerPickDto =
        childLock.withChildLock(childId) { earner.earn(childId, routine, day, "Morning Routine", "sun", FinishMode.TAPPED) }

    private fun claim(stickerId: Long, designId: Long) = post("/api/stickers/$stickerId/pick").header("X-Sticker-Bank", "1")
        .contentType(MediaType.APPLICATION_JSON).content("""{"designId": $designId}""")

    @Test
    fun `earn creates three distinct saved choices and reading is stable`() {
        val pick = earn()
        assertThat(pick.status).isEqualTo(StickerStatus.UNCLAIMED)
        assertThat(pick.choices.map { it.designId }).hasSize(3).doesNotHaveDuplicates()
        val a = mvc.perform(get("/api/stickers/${pick.stickerId}/pick")).andExpect(status().isOk).andReturn().response.contentAsString
        val b = mvc.perform(get("/api/stickers/${pick.stickerId}/pick")).andReturn().response.contentAsString
        assertThat(a).isEqualTo(b)
    }

    @Test
    fun `claim flow is idempotent and conflicts on another design`() {
        val pick = earn()
        val (first, second, third) = pick.choices.map { it.designId }
        mvc.perform(claim(pick.stickerId, first)).andExpect(status().isOk).andExpect(jsonPath("$.status").value("AVAILABLE"))
        val remaining = jdbc.sql("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?")
            .param(pick.stickerId).query(Int::class.java).single()
        assertThat(remaining).isZero()
        mvc.perform(claim(pick.stickerId, first)).andExpect(status().isOk)
        mvc.perform(claim(pick.stickerId, second)).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("ALREADY_CLAIMED"))
        assertThat(third).isNotEqualTo(first)
    }

    @Test
    fun `design not offered is 422`() {
        val pick = earn()
        val other = fixtures.activeDesignIds().first { id -> pick.choices.none { it.designId == id } }
        mvc.perform(claim(pick.stickerId, other)).andExpect(status().`is`(422))
            .andExpect(jsonPath("$.code").value("CHOICE_NOT_OFFERED"))
    }

    @Test
    fun `retired choice is still claimable and rename shows in pick`() {
        val pick = earn()
        val target = pick.choices.first().designId
        jdbc.sql("UPDATE sticker_design SET name = 'Renamed' WHERE id = ?").param(target).update()
        mvc.perform(get("/api/stickers/${pick.stickerId}/pick")).andExpect(jsonPath("$.choices[0].name").value("Renamed"))
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE id = ?").param(target).update()
        mvc.perform(claim(pick.stickerId, target)).andExpect(status().isOk)
    }

    @Test
    fun `pool of two gives two choices`() {
        fixtures.activeDesignIds().drop(2).forEach {
            jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE id = ?").param(it).update()
        }
        assertThat(earn().choices).hasSize(2)
    }

    @Test
    fun `empty pool awards fallback automatically`() {
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE is_fallback = FALSE").update()
        val pick = earn()
        assertThat(pick.autoAwarded).isTrue()
        assertThat(pick.status).isEqualTo(StickerStatus.AVAILABLE)
        assertThat(pick.claimed?.designId).isEqualTo(fixtures.fallbackDesignId())
        assertThat(pick.choices).isEmpty()
    }

    @Test
    fun `disabled categories also empty the pool`() {
        jdbc.sql("UPDATE sticker_category SET enabled = FALSE").update()
        jdbc.sql("UPDATE sticker_design SET category_id = category_id").update()
        val ids = fixtures.activeDesignIds()
        val pick = earn()
        assertThat(pick.autoAwarded).isEqualTo(ids.isEmpty())
    }

    @Test
    fun `duplicate earn for same routine and day is rejected`() {
        earn()
        assertThatThrownBy { earn() }.isInstanceOf(DuplicateKeyException::class.java)
    }

    @Test
    fun `book counts ordering paging and filter`() {
        val designs = fixtures.activeDesignIds()
        val routine2 = fixtures.createRoutine(childId, name = "Evening").routineId
        val routine3 = fixtures.createRoutine(childId, name = "Lunch").routineId
        fixtures.createSticker(childId, routineId, date, StickerStatus.AVAILABLE, designs[0])
        fixtures.createSticker(childId, routine2, date.plusDays(1), StickerStatus.PENDING, designs[1])
        fixtures.createSticker(childId, routine3, date.minusDays(1), StickerStatus.USED, designs[2])
        fixtures.createSticker(childId, null, date.minusDays(2), StickerStatus.UNCLAIMED, null)
        val all = mvc.perform(get("/api/children/$childId/stickers")).andExpect(status().isOk)
            .andExpect(jsonPath("$.counts.available").value(1)).andExpect(jsonPath("$.counts.pending").value(1))
            .andExpect(jsonPath("$.counts.used").value(1)).andExpect(jsonPath("$.counts.totalEarned").value(3))
            .andExpect(jsonPath("$.counts.unclaimed").value(1)).andExpect(jsonPath("$.items.length()").value(3))
            .andExpect(jsonPath("$.items[0].status").value("PENDING")).andReturn().response.contentAsString
        assertThat(all).doesNotContain("UNCLAIMED\",\"source")
        mvc.perform(get("/api/children/$childId/stickers?status=AVAILABLE")).andExpect(jsonPath("$.items.length()").value(1))
        val pageOne = mvc.perform(get("/api/children/$childId/stickers?limit=2")).andExpect(jsonPath("$.items.length()").value(2))
            .andReturn().response.contentAsString
        val cursor = JsonMapper().readTree(pageOne).get("nextCursor").asString()
        mvc.perform(get("/api/children/$childId/stickers?limit=2&cursor=$cursor")).andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.nextCursor").doesNotExist())
        mvc.perform(get("/api/children/$childId/stickers?status=UNCLAIMED")).andExpect(status().isBadRequest)
        mvc.perform(get("/api/children/$childId/stickers?cursor=!!")).andExpect(status().isBadRequest)
        mvc.perform(get("/api/children/999999/stickers")).andExpect(status().isNotFound)
    }

    @Test
    fun `detail of used sticker shows prize`() {
        val designId = fixtures.activeDesignIds().first()
        jdbc.sql(
            "INSERT INTO prize_request (child_id, status, created_by, prize_text, created_at, completed_at, updated_at) " +
                "VALUES (?, 'COMPLETED', 'CHILD', 'Ice cream', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        ).param(childId).update()
        val prizeId = jdbc.sql("SELECT MAX(id) FROM prize_request").query(Long::class.java).single()
        val id = fixtures.createSticker(childId, routineId, date, StickerStatus.USED, designId, prizeId)
        mvc.perform(get("/api/stickers/$id")).andExpect(status().isOk).andExpect(jsonPath("$.prize.prizeText").value("Ice cream"))
        mvc.perform(get("/api/stickers/999999")).andExpect(status().isNotFound)
    }

    @Test
    fun `concurrent claims with different designs yield exactly one success`() {
        val pick = earn()
        val ids = pick.choices.map { it.designId }
        val latch = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val futures = ids.take(2).map { designId ->
                pool.submit(
                    Callable {
                        latch.await()
                        mvc.perform(claim(pick.stickerId, designId)).andReturn().response.status
                    },
                )
            }
            latch.countDown()
            assertThat(futures.map { it.get() }).containsExactlyInAnyOrder(200, 409)
        } finally {
            pool.shutdown()
        }
        assertThat(clock.instant()).isNotNull()
    }
}
