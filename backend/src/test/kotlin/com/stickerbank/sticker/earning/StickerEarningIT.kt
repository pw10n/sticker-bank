package com.stickerbank.sticker.earning

import com.stickerbank.common.ChildLock
import com.stickerbank.common.EarnSource
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
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
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

    private fun earn(day: LocalDate = date, routine: Long = routineId): StickerPickDto = childLock.withChildLock(childId) {
        earner.earn(childId, EarnSource.Routine(routine), day, "Morning Routine", "sun", FinishMode.TAPPED)
    }

    private fun earnChore(
        choreId: Long,
        day: LocalDate = date,
        finishMode: FinishMode = FinishMode.TAPPED,
        earnedAt: Instant? = null,
    ): StickerPickDto = childLock.withChildLock(childId) {
        earner.earn(childId, EarnSource.Chore(choreId), day, "Tidy the playroom", "broom", finishMode, earnedAt)
    }

    private fun revoke(stickerId: Long) {
        jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(stickerId).update()
    }

    private fun retire(designIds: List<Long>) = designIds.forEach {
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE id = ?").param(it).update()
    }

    private fun savedChoices(stickerId: Long): List<Long> =
        jdbc.sql("SELECT design_id FROM sticker_pick_choice WHERE sticker_id = ? ORDER BY slot").param(stickerId)
            .query(Long::class.java).list().map { requireNotNull(it) }

    private fun stickerRow(stickerId: Long): Map<String, Any?> = jdbc.sql(
        "SELECT child_id, source, routine_id, chore_id, chart_date, routine_name, routine_icon_key, design_id, status, " +
            "prize_request_id, earned_at, claimed_at, finish_mode, is_live FROM sticker WHERE id = ?",
    ).param(stickerId).query().singleRow()

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
        // the offered set is kept after the claim so a re-earn after a revoke can offer it again (FR-12.5)
        val kept = jdbc.sql("SELECT COUNT(*) FROM sticker_pick_choice WHERE sticker_id = ?")
            .param(pick.stickerId).query(Int::class.java).single()
        assertThat(kept).isEqualTo(3)
        mvc.perform(get("/api/stickers/${pick.stickerId}/pick")).andExpect(jsonPath("$.choices.length()").value(0))
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
    fun `a routine sticker row is unchanged by the chore source`() {
        val pick = earn()
        val row = stickerRow(pick.stickerId)
        assertThat(row["source"]).isEqualTo("ROUTINE")
        assertThat((row["routine_id"] as Number).toLong()).isEqualTo(routineId)
        assertThat(row["chore_id"]).isNull()
        assertThat(row["routine_name"]).isEqualTo("Morning Routine")
        assertThat(row["routine_icon_key"]).isEqualTo("sun")
        assertThat(row["status"]).isEqualTo("UNCLAIMED")
        assertThat(row["finish_mode"]).isEqualTo("TAPPED")
        assertThat(row["design_id"]).isNull()
        assertThat(row["earned_at"]).isEqualTo(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
    }

    @Test
    fun `a chore earns a CHORE sticker with its chore_id, no routine_id and the chore snapshot`() {
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val pick = earnChore(chore.choreId)

        assertThat(pick.status).isEqualTo(StickerStatus.UNCLAIMED)
        assertThat(pick.autoAwarded).isFalse()
        assertThat(pick.childId).isEqualTo(childId)
        assertThat(pick.chartDate).isEqualTo(date)
        assertThat(pick.routineName).isEqualTo("Tidy the playroom")
        assertThat(pick.claimed).isNull()
        assertThat(pick.choices.map { it.designId }).hasSize(3).doesNotHaveDuplicates()
        assertThat(savedChoices(pick.stickerId)).isEqualTo(pick.choices.map { it.designId })

        val row = stickerRow(pick.stickerId)
        assertThat(row["source"]).isEqualTo("CHORE")
        assertThat((row["chore_id"] as Number).toLong()).isEqualTo(chore.choreId)
        assertThat(row["routine_id"]).isNull()
        assertThat((row["child_id"] as Number).toLong()).isEqualTo(childId)
        assertThat(row["chart_date"].toString()).isEqualTo("2026-10-14")
        assertThat(row["routine_name"]).isEqualTo("Tidy the playroom")
        assertThat(row["routine_icon_key"]).isEqualTo("broom")
        assertThat(row["status"]).isEqualTo("UNCLAIMED")
        assertThat(row["design_id"]).isNull()
        assertThat(row["prize_request_id"]).isNull()
        assertThat(row["claimed_at"]).isNull()
        assertThat(row["finish_mode"]).isEqualTo("TAPPED")
        assertThat((row["is_live"] as Number).toInt()).isEqualTo(1)
        assertThat(row["earned_at"]).isEqualTo(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))

        // the saved pick reads and claims like any other sticker
        mvc.perform(get("/api/stickers/${pick.stickerId}/pick")).andExpect(status().isOk)
            .andExpect(jsonPath("$.choices.length()").value(3)).andExpect(jsonPath("$.routineName").value("Tidy the playroom"))
        mvc.perform(claim(pick.stickerId, pick.choices.first().designId)).andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("AVAILABLE")).andExpect(jsonPath("$.source").value("CHORE"))
            .andExpect(jsonPath("$.routineName").value("Tidy the playroom"))
    }

    @Test
    fun `an automatic chore finish stores AUTO and the given earned_at`() {
        val chore = fixtures.createChore(childId, dueDate = date, checked = setOf(0, 1))
        val pick = earnChore(chore.choreId, finishMode = FinishMode.AUTO, earnedAt = Instant.parse("2026-10-15T00:00:00Z"))
        val row = stickerRow(pick.stickerId)
        assertThat(row["finish_mode"]).isEqualTo("AUTO")
        assertThat(row["earned_at"]).isEqualTo(LocalDateTime.parse("2026-10-15T00:00:00"))
        assertThat(row["source"]).isEqualTo("CHORE")
    }

    @Test
    fun `a second live sticker for the same chore is refused, on the same day and on another`() {
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val first = earnChore(chore.choreId)
        assertThatThrownBy { earnChore(chore.choreId) }.isInstanceOf(DuplicateKeyException::class.java)
        // BR-20: the key is the chore, not the chore and its day
        assertThatThrownBy { earnChore(chore.choreId, day = date.plusDays(1)) }.isInstanceOf(DuplicateKeyException::class.java)
        val ids = jdbc.sql("SELECT id FROM sticker WHERE chore_id = ?").param(chore.choreId).query(Long::class.java).list()
        assertThat(ids).containsExactly(first.stickerId)
        // the refused inserts left no choices behind
        assertThat(jdbc.sql("SELECT COUNT(*) FROM sticker_pick_choice").query(Int::class.java).single()).isEqualTo(3)

        // another chore of the same child is not affected
        val other = fixtures.createChore(childId, name = "Feed the fish")
        assertThat(earnChore(other.choreId).status).isEqualTo(StickerStatus.UNCLAIMED)
    }

    @Test
    fun `a chore re-earn after a revoke copies the saved choices in the same slots, on any date`() {
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val first = earnChore(chore.choreId)
        val offered = first.choices.map { it.designId }
        // claimed first: the choices stay on the row through the claim and the revoke (FR-12.5)
        mvc.perform(claim(first.stickerId, offered[1])).andExpect(status().isOk)
        revoke(first.stickerId)
        // a design retired in between is still offered, as in an unclaimed pick (BR-8)
        retire(listOf(offered[0]))

        val second = earnChore(chore.choreId, day = date.plusDays(3))
        assertThat(second.stickerId).isNotEqualTo(first.stickerId)
        assertThat(second.status).isEqualTo(StickerStatus.UNCLAIMED)
        assertThat(second.choices.map { it.designId }).containsExactlyElementsOf(offered)
        assertThat(savedChoices(second.stickerId)).containsExactlyElementsOf(offered)
        assertThat(savedChoices(first.stickerId)).containsExactlyElementsOf(offered)
        assertThat(stickerRow(second.stickerId)["chart_date"].toString()).isEqualTo("2026-10-17")

        // revoked more than once: still the same set
        revoke(second.stickerId)
        val third = earnChore(chore.choreId, day = date.plusDays(5))
        assertThat(third.choices.map { it.designId }).containsExactlyElementsOf(offered)
        assertThat(jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE chore_id = ?").param(chore.choreId).query(Int::class.java).single())
            .isEqualTo(1)
    }

    @Test
    fun `a chore re-earn copies the latest revoked sticker that still has choices`() {
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val designs = fixtures.activeDesignIds()
        val older = designs.take(3)
        val newer = designs.takeLast(3).reversed()
        fixtures.createChoreSticker(childId, chore.choreId, date, StickerStatus.REVOKED, choices = older)
        fixtures.createChoreSticker(childId, chore.choreId, date.plusDays(1), StickerStatus.REVOKED, choices = newer)
        // the newest revoked row was the automatic fallback and has no choices, so it is passed over
        fixtures.createChoreSticker(childId, chore.choreId, date.plusDays(2), StickerStatus.REVOKED, fixtures.fallbackDesignId())

        assertThat(earnChore(chore.choreId).choices.map { it.designId }).containsExactlyElementsOf(newer)
    }

    @Test
    fun `a chore gets the fallback sticker when the pool is empty`() {
        jdbc.sql("UPDATE sticker_design SET status = 'RETIRED' WHERE is_fallback = FALSE").update()
        val chore = fixtures.createChore(childId, checked = setOf(0, 1))
        val pick = earnChore(chore.choreId)
        assertThat(pick.autoAwarded).isTrue()
        assertThat(pick.status).isEqualTo(StickerStatus.AVAILABLE)
        assertThat(pick.claimed?.designId).isEqualTo(fixtures.fallbackDesignId())
        assertThat(pick.choices).isEmpty()
        assertThat(pick.routineName).isEqualTo("Tidy the playroom")

        val row = stickerRow(pick.stickerId)
        assertThat(row["source"]).isEqualTo("CHORE")
        assertThat((row["chore_id"] as Number).toLong()).isEqualTo(chore.choreId)
        assertThat(row["routine_id"]).isNull()
        assertThat(row["status"]).isEqualTo("AVAILABLE")
        assertThat((row["design_id"] as Number).toLong()).isEqualTo(fixtures.fallbackDesignId())
        assertThat(row["claimed_at"]).isNotNull()
        assertThat(savedChoices(pick.stickerId)).isEmpty()
        // still one live sticker per chore
        assertThatThrownBy { earnChore(chore.choreId) }.isInstanceOf(DuplicateKeyException::class.java)
    }

    @Test
    fun `a routine and a chore with the same id do not see each other's previous choices`() {
        // the chore deliberately shares the routine's id: only the owner column tells them apart
        jdbc.sql(
            "INSERT INTO chore (id, child_id, name, icon_key, due_date, created_at, updated_at) " +
                "VALUES (?, ?, 'Tidy the playroom', 'broom', NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        ).params(routineId, childId).update()
        val choreId = routineId
        val designs = fixtures.activeDesignIds()
        val routineSet = designs.take(3)
        val choreSet = designs.drop(3).take(3)

        // 1) only the routine has a revoked sticker with choices, on the day the chore is finished
        val revokedRoutine = fixtures.createSticker(childId, routineId, date, StickerStatus.REVOKED, null)
        routineSet.forEachIndexed { i, d ->
            jdbc.sql(
                "INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)",
            ).params(revokedRoutine, i + 1, d).update()
        }
        // retired designs are never drawn afresh, so the chore can only show them by copying the routine's set
        retire(routineSet)
        val chorePick = earnChore(choreId)
        assertThat(chorePick.choices.map { it.designId }).hasSize(3).doesNotContainAnyElementsOf(routineSet)

        // 2) now the chore has a revoked sticker with choices too, and the routine still copies its own set
        revoke(chorePick.stickerId)
        jdbc.sql("DELETE FROM sticker_pick_choice WHERE sticker_id = ?").param(chorePick.stickerId).update()
        choreSet.forEachIndexed { i, d ->
            jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)")
                .params(chorePick.stickerId, i + 1, d).update()
        }
        retire(choreSet)
        assertThat(earn().choices.map { it.designId }).containsExactlyElementsOf(routineSet)
        // a routine day with no revoked sticker of its own draws afresh, never from the chore's set
        assertThat(earn(day = date.plusDays(1)).choices.map { it.designId })
            .hasSize(3).doesNotContainAnyElementsOf(choreSet).doesNotContainAnyElementsOf(routineSet)
        // and the chore copies its own set, not the routine's
        assertThat(earnChore(choreId, day = date.plusDays(1)).choices.map { it.designId }).containsExactlyElementsOf(choreSet)

        // one live sticker for the routine day and one for the chore live side by side
        assertThat(jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE routine_id = ?").param(routineId).query(Int::class.java).single())
            .isEqualTo(2)
        assertThat(jdbc.sql("SELECT COUNT(*) FROM live_sticker WHERE chore_id = ?").param(choreId).query(Int::class.java).single())
            .isEqualTo(1)
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
