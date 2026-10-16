package com.stickerbank.child

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import jakarta.servlet.http.Cookie
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate
import java.time.LocalDateTime

@IntegrationTest
class ChildIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    private lateinit var cookie: Cookie

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        fixtures.setPin()
        cookie = fixtures.parentCookie(fixtures.createParentSession())
    }

    private fun body(name: String, avatar: String = "cat-face", color: String = "#ffb703") =
        """{"name":"$name","avatarKey":"$avatar","themeColor":"$color"}"""

    private fun create(name: String) = mvc.perform(
        post(
            "/api/parent/children",
        ).cookie(cookie).header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body(name)),
    )

    @Test
    fun `crud round trip with ordering`() {
        create("Jane Doe").andExpect(status().isCreated).andExpect(jsonPath("$.position").value(1))
            .andExpect(jsonPath("$.themeColor").value("#FFB703"))
        val secondId = create("  John Doe ").andExpect(status().isCreated).andExpect(jsonPath("$.position").value(2))
            .andReturn().response.contentAsString.let { Regex("\"id\":(\\d+)").find(it)!!.groupValues[1].toLong() }

        mvc.perform(get("/api/parent/children").cookie(cookie))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].name").value("Jane Doe"))
            .andExpect(jsonPath("$[1].name").value("John Doe"))

        mvc.perform(
            put("/api/parent/children/$secondId").cookie(cookie).header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content(body("Johnny Doe", "dog-face", "#4CC9F0")),
        ).andExpect(status().isOk).andExpect(jsonPath("$.name").value("Johnny Doe")).andExpect(jsonPath("$.avatarKey").value("dog-face"))

        mvc.perform(
            put("/api/parent/children/999999").cookie(cookie).header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content(body("Nobody")),
        ).andExpect(status().isNotFound).andExpect(jsonPath("$.code").value("NOT_FOUND"))

        mvc.perform(delete("/api/parent/children/$secondId").cookie(cookie).header("X-Sticker-Bank", "1")).andExpect(status().isNoContent)
        mvc.perform(delete("/api/parent/children/$secondId").cookie(cookie).header("X-Sticker-Bank", "1")).andExpect(status().isNotFound)
        mvc.perform(get("/api/parent/children").cookie(cookie)).andExpect(jsonPath("$.length()").value(1))
    }

    @Test
    fun `invalid input is rejected`() {
        listOf(body("Jane", avatar = "nope"), body("Jane", color = "#123456"), body("   "), body("a".repeat(41))).forEach { json ->
            mvc.perform(
                post("/api/parent/children").cookie(cookie).header("X-Sticker-Bank", "1")
                    .contentType(MediaType.APPLICATION_JSON).content(json),
            ).andExpect(status().isBadRequest).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
        }
        assertThat(count("child")).isZero()
    }

    private fun count(table: String): Int = jdbc.sql("SELECT COUNT(*) FROM $table").query(Int::class.java).single()

    private fun countFor(table: String, column: String, id: Long): Int =
        jdbc.sql("SELECT COUNT(*) FROM $table WHERE $column = ?").param(id).query(Int::class.java).single()

    @Test
    fun `deleting a child cascades to all of its data only`() {
        val today = LocalDate.parse("2026-10-15")
        val designs = fixtures.activeDesignIds()
        val jane = fixtures.createChild("Jane Doe")
        val john = fixtures.createChild("John Doe", "dog-face", "#4CC9F0")
        val r = fixtures.createRoutine(jane)
        val rb = fixtures.createRoutine(jane, name = "Bedtime", iconKey = "crescent-moon")
        val rc = fixtures.createRoutine(jane, name = "Chores")
        val rd = fixtures.createRoutine(jane, name = "Reading")
        val re = fixtures.createRoutine(jane, name = "Tidy")
        r.taskIds.forEach { fixtures.completeTask(jane, r.routineId, it, today.minusDays(1)) }
        jdbc.sql("INSERT INTO routine_skip (routine_id, chart_date, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))")
            .params(rb.routineId, today.minusDays(2)).update()

        val unclaimed = fixtures.createSticker(jane, r.routineId, today.minusDays(1), StickerStatus.UNCLAIMED, null)
        (1..3).forEach { slot ->
            jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, ?, ?)")
                .params(unclaimed, slot, designs[slot - 1]).update()
        }
        fixtures.createSticker(jane, rb.routineId, today.minusDays(3), StickerStatus.AVAILABLE, designs[0])
        val pendingReq = prizeRequest(jane, "PENDING", null)
        val pendingSticker = fixtures.createSticker(jane, rc.routineId, today.minusDays(4), StickerStatus.PENDING, designs[1], pendingReq)
        jdbc.sql("INSERT INTO prize_request_item (prize_request_id, sticker_id) VALUES (?, ?)").params(pendingReq, pendingSticker).update()
        val doneReq = prizeRequest(jane, "COMPLETED", "Trip to the playground")
        val usedSticker = fixtures.createSticker(jane, rd.routineId, today.minusDays(5), StickerStatus.USED, designs[2], doneReq)
        jdbc.sql("INSERT INTO prize_request_item (prize_request_id, sticker_id) VALUES (?, ?)").params(doneReq, usedSticker).update()
        fixtures.createSticker(jane, re.routineId, today.minusDays(6), StickerStatus.AVAILABLE, designs[3])

        val revokedSticker = fixtures.createSticker(jane, r.routineId, today.minusDays(7), StickerStatus.REVOKED, designs[0])
        jdbc.sql(
            "INSERT INTO sticker_revocation (sticker_id, child_id, chart_date, task_id, task_label, from_status, revoked_at) " +
                "VALUES (?, ?, ?, ?, 'Brush teeth', 'AVAILABLE', UTC_TIMESTAMP(3))",
        ).params(revokedSticker, jane, today.minusDays(7), r.taskIds[0]).update()
        assertThat(countFor("sticker_revocation", "child_id", jane)).isOne()
        val other = fixtures.createRoutine(john)
        other.taskIds.forEach { fixtures.completeTask(john, other.routineId, it, today.minusDays(1)) }
        val otherSticker = fixtures.createSticker(john, other.routineId, today.minusDays(1), StickerStatus.AVAILABLE, designs[0])
        val designCount = count("sticker_design")
        val johnRows = snapshot(john, other.routineId)

        mvc.perform(delete("/api/parent/children/$jane").cookie(cookie).header("X-Sticker-Bank", "1")).andExpect(status().isNoContent)

        val routineIds = listOf(r, rb, rc, rd, re).map { it.routineId }
        assertThat(countFor("child", "id", jane)).isZero()
        assertThat(countFor("routine", "child_id", jane)).isZero()
        assertThat(countFor("task_completion", "child_id", jane)).isZero()
        assertThat(countFor("sticker", "child_id", jane)).isZero()
        assertThat(countFor("prize_request", "child_id", jane)).isZero()
        assertThat(countFor("sticker_revocation", "child_id", jane)).isZero()
        routineIds.forEach { id ->
            assertThat(countFor("routine_revision", "routine_id", id)).isZero()
            assertThat(countFor("task", "routine_id", id)).isZero()
            assertThat(countFor("routine_skip", "routine_id", id)).isZero()
        }
        (r.taskIds + rb.taskIds).forEach { assertThat(countFor("revision_task", "task_id", it)).isZero() }
        assertThat(countFor("sticker_pick_choice", "sticker_id", unclaimed)).isZero()
        assertThat(countFor("prize_request_item", "prize_request_id", pendingReq)).isZero()
        assertThat(countFor("prize_request_item", "prize_request_id", doneReq)).isZero()

        assertThat(snapshot(john, other.routineId)).isEqualTo(johnRows)
        assertThat(countFor("sticker", "id", otherSticker)).isEqualTo(1)
        assertThat(count("sticker_design")).isEqualTo(designCount)
    }

    private fun snapshot(childId: Long, routineId: Long): List<Int> = listOf(
        countFor("child", "id", childId),
        countFor("routine", "child_id", childId),
        countFor("routine_revision", "routine_id", routineId),
        countFor("task", "routine_id", routineId),
        countFor("task_completion", "child_id", childId),
        countFor("sticker", "child_id", childId),
    ).also { assertThat(it).allMatch { n -> n >= 1 } }

    private fun prizeRequest(childId: Long, status: String, prize: String?): Long {
        val now = LocalDateTime.parse("2026-10-15T15:00:00")
        jdbc.sql(
            "INSERT INTO prize_request (child_id, status, created_by, prize_text, created_at, completed_at, updated_at) " +
                "VALUES (?, ?, 'CHILD', ?, ?, ?, ?)",
        ).params(listOf<Any?>(childId, status, prize, now, if (status == "COMPLETED") now else null, now)).update()
        return jdbc.sql("SELECT MAX(id) FROM prize_request").query(Long::class.java).single()
    }
}
