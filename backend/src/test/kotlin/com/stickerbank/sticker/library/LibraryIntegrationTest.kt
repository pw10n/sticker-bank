package com.stickerbank.sticker.library

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
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.LocalDate

@IntegrationTest
class LibraryIntegrationTest {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var jdbc: JdbcClient

    @BeforeEach
    fun reset() {
        dbCleaner.reset()
        fixtures.setPin()
        parentToken = fixtures.createParentSession()
    }

    private lateinit var parentToken: String

    private fun json(builder: MockHttpServletRequestBuilder, body: String? = null): ResultActions {
        builder.header("X-Sticker-Bank", "1").cookie(fixtures.parentCookie(parentToken))
        if (body != null) builder.contentType(MediaType.APPLICATION_JSON).content(body)
        return mvc.perform(builder)
    }

    private fun designId(name: String): Long =
        jdbc.sql("SELECT id FROM sticker_design WHERE name = ?").param(name).query(Long::class.java).single()

    private fun categoryId(name: String): Long =
        jdbc.sql("SELECT id FROM sticker_category WHERE name = ?").param(name).query(Long::class.java).single()

    @Test
    fun `list shows the starter set without the fallback`() {
        json(get("/api/parent/library/designs"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.activeCount").value(24))
            .andExpect(jsonPath("$.designs.length()").value(24))
            .andExpect(jsonPath("$.designs[?(@.name == 'Gold Star')]").isEmpty)
    }

    @Test
    fun `filters by name status and category`() {
        json(get("/api/parent/library/designs").param("q", "RO"))
            .andExpect(jsonPath("$.designs[?(@.name == 'Rocket')]").isNotEmpty)
        json(get("/api/parent/library/designs").param("q", "%")).andExpect(jsonPath("$.designs.length()").value(0))
        json(put("/api/parent/library/designs/${designId("Rocket")}/status"), """{"status":"RETIRED"}""")
        json(get("/api/parent/library/designs").param("status", "RETIRED"))
            .andExpect(jsonPath("$.designs.length()").value(1))
            .andExpect(jsonPath("$.activeCount").value(23))
        json(get("/api/parent/library/designs").param("categoryId", categoryId("Space").toString()))
            .andExpect(jsonPath("$.designs.length()").value(6))
    }

    @Test
    fun `create and update validate artwork and category`() {
        json(post("/api/parent/library/designs"), """{"name":"  Test Pal ","artworkKey":"rocket"}""")
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.name").value("Test Pal"))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
        json(post("/api/parent/library/designs"), """{"name":"X","artworkKey":"nope"}""")
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("artworkKey"))
        json(post("/api/parent/library/designs"), """{"name":"X","artworkKey":"rocket","categoryId":999999}""")
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("categoryId"))
        json(put("/api/parent/library/designs/${designId("Rocket")}"), """{"name":"Big Rocket","artworkKey":"lion"}""")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.name").value("Big Rocket"))
            .andExpect(jsonPath("$.artworkKey").value("lion"))
    }

    @Test
    fun `retire and reactivate change the pool`() {
        val id = designId("Rocket")
        json(put("/api/parent/library/designs/$id/status"), """{"status":"RETIRED"}""")
            .andExpect(jsonPath("$.status").value("RETIRED"))
        json(get("/api/parent/library/designs")).andExpect(jsonPath("$.activeCount").value(23))
        json(put("/api/parent/library/designs/$id/status"), """{"status":"ACTIVE"}""")
            .andExpect(jsonPath("$.status").value("ACTIVE"))
        json(get("/api/parent/library/designs")).andExpect(jsonPath("$.activeCount").value(24))
    }

    @Test
    fun `disabling a category removes its designs from the pool only`() {
        val space = categoryId("Space")
        json(put("/api/parent/library/categories/$space"), """{"name":"Space","enabled":false}""")
            .andExpect(status().isOk).andExpect(jsonPath("$.enabled").value(false))
        json(get("/api/parent/library/designs"))
            .andExpect(jsonPath("$.activeCount").value(18))
            .andExpect(jsonPath("$.designs.length()").value(24))
        val retired = jdbc.sql("SELECT COUNT(*) FROM sticker_design WHERE status = 'RETIRED'").query(Int::class.java).single()
        assertThat(retired).isZero()
    }

    @Test
    fun `delete unused design succeeds`() {
        json(delete("/api/parent/library/designs/${designId("Rocket")}")).andExpect(status().isNoContent)
    }

    @Test
    fun `delete of an earned design is refused`() {
        val id = designId("Rocket")
        val child = fixtures.createChild()
        val routine = fixtures.createRoutine(child)
        fixtures.createSticker(child, routine.routineId, LocalDate.parse("2026-10-14"), StickerStatus.AVAILABLE, id)
        json(delete("/api/parent/library/designs/$id"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
            .andExpect(jsonPath("$.detail").value("This sticker has been earned. Retire it instead."))
    }

    @Test
    fun `design used only by a revoked sticker is in use and cannot be deleted`() {
        val id = designId("Rocket")
        val child = fixtures.createChild()
        val routine = fixtures.createRoutine(child)
        fixtures.createSticker(child, routine.routineId, LocalDate.parse("2026-10-14"), StickerStatus.REVOKED, id)
        json(get("/api/parent/library/designs")).andExpect(status().isOk)
            .andExpect(jsonPath("$.designs[?(@.id == $id)].inUse").value(true))
        json(delete("/api/parent/library/designs/$id"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
    }

    @Test
    fun `delete of a design offered as a pick choice is refused`() {
        val id = designId("Rocket")
        val child = fixtures.createChild()
        val routine = fixtures.createRoutine(child)
        val sticker = fixtures.createSticker(child, routine.routineId, LocalDate.parse("2026-10-14"), StickerStatus.UNCLAIMED, null)
        jdbc.sql("INSERT INTO sticker_pick_choice (sticker_id, slot, design_id) VALUES (?, 1, ?)").params(sticker, id).update()
        json(delete("/api/parent/library/designs/$id"))
            .andExpect(status().isConflict).andExpect(jsonPath("$.code").value("DESIGN_IN_USE"))
    }

    @Test
    fun `fallback design cannot be touched`() {
        val id = fixtures.fallbackDesignId()
        json(put("/api/parent/library/designs/$id"), """{"name":"X","artworkKey":"rocket"}""").andExpect(status().isNotFound)
        json(put("/api/parent/library/designs/$id/status"), """{"status":"RETIRED"}""").andExpect(status().isNotFound)
        json(delete("/api/parent/library/designs/$id")).andExpect(status().isNotFound)
    }

    @Test
    fun `category crud and duplicate names`() {
        json(get("/api/parent/library/categories"))
            .andExpect(jsonPath("$.length()").value(4))
            .andExpect(jsonPath("$[0].designCount").value(6))
        json(post("/api/parent/library/categories"), """{"name":"Toys"}""")
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.position").value(5))
            .andExpect(jsonPath("$.enabled").value(true))
        json(post("/api/parent/library/categories"), """{"name":"Toys"}""")
            .andExpect(status().isBadRequest).andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
        val toys = categoryId("Toys")
        json(put("/api/parent/library/categories/$toys"), """{"name":"Playthings","enabled":true}""")
            .andExpect(jsonPath("$.name").value("Playthings"))
        json(delete("/api/parent/library/categories/$toys")).andExpect(status().isNoContent)
        json(delete("/api/parent/library/categories/$toys")).andExpect(status().isNotFound)
    }

    @Test
    fun `deleting a category leaves its designs uncategorised`() {
        val space = categoryId("Space")
        json(delete("/api/parent/library/categories/$space")).andExpect(status().isNoContent)
        json(get("/api/parent/library/designs"))
            .andExpect(jsonPath("$.designs.length()").value(24))
        val categoryId = jdbc.sql("SELECT category_id FROM sticker_design WHERE name = 'Rocket'").query(Long::class.java).optional()
        assertThat(categoryId).isEmpty
    }
}
