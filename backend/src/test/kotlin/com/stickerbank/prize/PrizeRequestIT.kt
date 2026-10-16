package com.stickerbank.prize

import com.stickerbank.common.StickerStatus
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@IntegrationTest
class PrizeRequestIT {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    private var parent = false
    private var token = ""
    private var childId = 0L
    private var routineId = 0L
    private var designId = 0L

    @BeforeEach
    fun setUp() {
        dbCleaner.reset()
        parent = false
        fixtures.setPin()
        token = fixtures.createParentSession()
        childId = fixtures.createChild("Jane Doe")
        routineId = fixtures.createRoutine(childId).routineId
        designId = fixtures.activeDesignIds().first()
    }

    private var day = 0L

    private fun sticker(status: StickerStatus = StickerStatus.AVAILABLE, child: Long = childId): Long {
        val rid = if (child == childId) routineId else fixtures.createRoutine(child).routineId
        return fixtures.createSticker(child, rid, LocalDate.of(2026, 9, 1).plusDays(day++), status, designId)
    }

    private fun auth(b: MockHttpServletRequestBuilder) = if (parent) b.cookie(fixtures.parentCookie(token)) else b

    private fun create(ids: List<Long>, child: Long = childId): MvcResult = mvc.perform(
        auth(post("/api/children/$child/prize-requests")).header("X-Sticker-Bank", "1")
            .contentType(MediaType.APPLICATION_JSON).content("""{"stickerIds":${ids.joinToString(prefix = "[", postfix = "]")}}"""),
    ).andReturn()

    private fun idOf(r: MvcResult): Long = Regex("\"id\":(\\d+)").find(r.response.contentAsString)!!.groupValues[1].toLong()

    private fun act(path: String, body: String? = null, method: String = "POST") = mvc.perform(
        auth(if (method == "PUT") put(path) else post(path)).header("X-Sticker-Bank", "1")
            .contentType(MediaType.APPLICATION_JSON).content(body ?: "{}"),
    )

    private fun stickerStatus(id: Long) = jdbc.sql("SELECT status FROM sticker WHERE id = ?").param(id).query(String::class.java).single()

    @Test
    fun `create makes stickers pending and is visible as pending`() {
        val a = sticker()
        val b = sticker()
        val r = create(listOf(a, b))
        assertThat(r.response.status).isEqualTo(201)
        assertThat(r.response.contentAsString).contains("\"createdBy\":\"CHILD\"", "\"stickerCount\":2")
        assertThat(stickerStatus(a)).isEqualTo("PENDING")
        mvc.perform(auth(get("/api/children/$childId/prize-requests/pending")))
            .andExpect(status().isOk).andExpect(jsonPath("$.request.id").value(idOf(r)))
    }

    @Test
    fun `create for an unknown child is 404 not found`() {
        val r = create(listOf(sticker()), child = childId + 9999)
        assertThat(r.response.status).isEqualTo(404)
        assertThat(r.response.contentAsString).contains("NOT_FOUND").doesNotContain("STICKER_NOT_AVAILABLE")
    }

    @Test
    fun `second create conflicts for child and parent`() {
        create(listOf(sticker()))
        assertThat(create(listOf(sticker())).response.status).isEqualTo(409)
        parent = true
        val r = create(listOf(sticker()))
        assertThat(r.response.status).isEqualTo(409)
        assertThat(r.response.contentAsString).contains("PENDING_REQUEST_EXISTS")
    }

    @Test
    fun `parent started request is created by parent`() {
        parent = true
        val r = create(listOf(sticker()))
        assertThat(r.response.status).isEqualTo(201)
        assertThat(r.response.contentAsString).contains("\"createdBy\":\"PARENT\"")
    }

    @Test
    fun `unavailable stickers are rejected`() {
        val sibling = fixtures.createChild("John Doe")
        val other = sticker(child = sibling)
        val pending = sticker(StickerStatus.PENDING)
        val used = sticker(StickerStatus.USED)
        for (id in listOf(other, pending, used, 999_999L)) {
            val r = create(listOf(id))
            assertThat(r.response.status).isEqualTo(409)
            assertThat(r.response.contentAsString).contains("STICKER_NOT_AVAILABLE")
        }
    }

    @Test
    fun `empty list is 400 and unknown child 404`() {
        assertThat(create(emptyList()).response.status).isEqualTo(400)
        assertThat(create(listOf(sticker()), child = 999_999L).response.status).isEqualTo(404)
    }

    @Test
    fun `cancel returns stickers and cannot repeat`() {
        val a = sticker()
        val id = idOf(create(listOf(a)))
        parent = true
        act("/api/prize-requests/$id/cancel").andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("CANCELLED")).andExpect(jsonPath("$.cancelledBy").value("PARENT"))
            .andExpect(jsonPath("$.stickerCount").value(1))
        assertThat(stickerStatus(a)).isEqualTo("AVAILABLE")
        act("/api/prize-requests/$id/cancel").andExpect(status().isConflict)
        act("/api/prize-requests/999999/cancel").andExpect(status().isNotFound)
    }

    @Test
    fun `complete then edit`() {
        val a = sticker()
        val id = idOf(create(listOf(a)))
        parent = true
        act("/api/parent/prize-requests/$id", """{"prizeText":"Toy"}""", "PUT")
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("REQUEST_NOT_COMPLETED"))
        act("/api/parent/prize-requests/$id/complete", """{"prizeText":"  "}""").andExpect(status().isBadRequest)
        act("/api/parent/prize-requests/$id/complete", """{"prizeText":" Ice cream ","note":"  "}""")
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("COMPLETED"))
            .andExpect(jsonPath("$.prizeText").value("Ice cream")).andExpect(jsonPath("$.note").doesNotExist())
        assertThat(stickerStatus(a)).isEqualTo("USED")
        act("/api/parent/prize-requests/$id/complete", """{"prizeText":"x"}""").andExpect(status().isConflict)
        act("/api/parent/prize-requests/$id", """{"prizeText":"Book","note":"bedtime"}""", "PUT")
            .andExpect(status().isOk).andExpect(jsonPath("$.prizeText").value("Book")).andExpect(jsonPath("$.note").value("bedtime"))
    }

    @Test
    fun `list filters by status and child and pages by cursor`() {
        val sibling = fixtures.createChild("John Doe")
        val first = idOf(create(listOf(sticker())))
        parent = true
        act("/api/prize-requests/$first/cancel")
        parent = false
        val second = idOf(create(listOf(sticker())))
        parent = true
        act("/api/parent/prize-requests/$second/complete", """{"prizeText":"Toy"}""")
        parent = false
        val third = idOf(create(listOf(sticker())))
        val other = idOf(create(listOf(sticker(child = sibling)), sibling))
        parent = true

        mvc.perform(auth(get("/api/parent/prize-requests?status=PENDING&status=COMPLETED&childId=$childId")))
            .andExpect(status().isOk).andExpect(jsonPath("$.items.length()").value(2))
        mvc.perform(auth(get("/api/parent/prize-requests?childId=$childId")))
            .andExpect(jsonPath("$.items.length()").value(3))
            .andExpect(jsonPath("$.items[2].id").value(first))
            .andExpect(jsonPath("$.items[2].stickerCount").value(1))
        mvc.perform(auth(get("/api/parent/prize-requests?status=PENDING"))).andExpect(jsonPath("$.items.length()").value(2))

        val seen = mutableListOf<Long>()
        var cursor: String? = null
        do {
            val url = "/api/parent/prize-requests?limit=1" + (cursor?.let { "&cursor=$it" } ?: "")
            val body = mvc.perform(auth(get(url))).andReturn().response.contentAsString
            seen += Regex("\"id\":(\\d+)").find(body)!!.groupValues[1].toLong()
            cursor = Regex("\"nextCursor\":\"([^\"]+)\"").find(body)?.groupValues?.get(1)
        } while (cursor != null)
        assertThat(seen).containsExactlyInAnyOrder(first, second, third, other)
        assertThat(seen).isSortedAccordingTo(Comparator.reverseOrder())
        mvc.perform(auth(get("/api/parent/prize-requests?cursor=%21%21"))).andExpect(status().isBadRequest)
    }

    @Test
    fun `concurrent creates yield exactly one request`() {
        val a = sticker()
        val b = sticker()
        val pool = Executors.newFixedThreadPool(2)
        val start = CountDownLatch(1)
        val futures =
            listOf(a, b).map { sid ->
                pool.submit<Int> {
                    start.await()
                    create(listOf(sid)).response.status
                }
            }
        start.countDown()
        val codes = futures.map { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()
        assertThat(codes.sorted()).containsExactly(201, 409)
    }
}
