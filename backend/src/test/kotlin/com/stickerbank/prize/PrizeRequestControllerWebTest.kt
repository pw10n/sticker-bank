package com.stickerbank.prize

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.Actor
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import io.mockk.verify
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant

@WebMvcTest(PrizeRequestController::class)
class PrizeRequestControllerWebTest {
    @Autowired
    lateinit var mvc: MockMvc

    @MockkBean
    lateinit var service: PrizeRequestService

    @MockkBean
    lateinit var sessions: ParentSessionReader

    private val sample =
        PrizeRequestDto(
            7, 1, "Jane Doe", PrizeRequestStatus.PENDING, Actor.CHILD, 0, emptyList(), null, null,
            Instant.parse("2026-10-15T15:00:00Z"), null, null, null, null, null,
        )

    private fun send(builder: MockHttpServletRequestBuilder, json: String?) = mvc.perform(
        builder.header("X-Sticker-Bank", "1").also { if (json != null) it.contentType(MediaType.APPLICATION_JSON).content(json) },
    )

    @BeforeEach
    fun setUp() {
        every { sessions.hasValidSession(any()) } returns false
    }

    @Test
    fun `create returns 201 with child actor`() {
        every { service.create(1, listOf(1, 2), Actor.CHILD) } returns sample
        send(post("/api/children/1/prize-requests"), """{"stickerIds":[1,2]}""")
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.id").value(7))
            .andExpect(jsonPath("$.createdBy").value("CHILD"))
    }

    @Test
    fun `create passes parent actor when a parent session exists`() {
        every { sessions.hasValidSession(any()) } returns true
        every { service.create(1, listOf(3), Actor.PARENT) } returns sample.copy(createdBy = Actor.PARENT)
        send(post("/api/children/1/prize-requests"), """{"stickerIds":[3]}""")
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.createdBy").value("PARENT"))
        verify { service.create(1, listOf(3), Actor.PARENT) }
    }

    @Test
    fun `empty sticker list is rejected`() {
        send(post("/api/children/1/prize-requests"), """{"stickerIds":[]}""")
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
    }

    @Test
    fun `domain conflicts become problem codes`() {
        every { service.create(1, listOf(1), Actor.CHILD) } throws
            DomainException(ErrorCode.STICKER_NOT_AVAILABLE, null, mapOf("stickerIds" to listOf(1L)))
        send(post("/api/children/1/prize-requests"), """{"stickerIds":[1]}""")
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("STICKER_NOT_AVAILABLE"))
            .andExpect(jsonPath("$.stickerIds[0]").value(1))
    }

    @Test
    fun `cancel maps not pending to 409 and passes actor`() {
        every { service.cancel(7, Actor.CHILD) } throws DomainException(ErrorCode.REQUEST_NOT_PENDING)
        send(post("/api/prize-requests/7/cancel"), null)
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("REQUEST_NOT_PENDING"))
    }

    @Test
    fun `pending returns wrapper and unknown child is 404`() {
        every { service.pending(1) } returns PendingPrizeRequestDto(null)
        every { service.pending(2) } throws DomainException(ErrorCode.NOT_FOUND)
        mvc.perform(get("/api/children/1/prize-requests/pending"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.request").doesNotExist())
        mvc.perform(get("/api/children/2/prize-requests/pending")).andExpect(status().isNotFound)
    }

    @Test
    fun `complete with blank prize text is a field error`() {
        every { sessions.hasValidSession(any()) } returns true
        send(post("/api/parent/prize-requests/7/complete"), """{"prizeText":"  ","note":null}""").andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("prizeText"))
    }

    @Test
    fun `edit pending is 409`() {
        every { sessions.hasValidSession(any()) } returns true
        every { service.edit(7, PrizeEditRequest("Toy", null)) } throws DomainException(ErrorCode.REQUEST_NOT_COMPLETED)
        send(put("/api/parent/prize-requests/7"), """{"prizeText":"Toy"}""")
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("REQUEST_NOT_COMPLETED"))
    }

    @Test
    fun `list passes repeated statuses and defaults`() {
        every { sessions.hasValidSession(any()) } returns true
        every { service.list(listOf(PrizeRequestStatus.PENDING, PrizeRequestStatus.COMPLETED), 4, null, 50) } returns
            PrizeRequestPageDto(listOf(sample), "abc")
        mvc.perform(get("/api/parent/prize-requests?status=PENDING&status=COMPLETED&childId=4"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.nextCursor").value("abc"))
            .andExpect(jsonPath("$.items[0].id").value(7))
    }

    @Test
    fun `malformed cursor surfaces as 400`() {
        every { sessions.hasValidSession(any()) } returns true
        every { service.list(null, null, "zzz", 50) } throws PrizeSupport.validation("cursor", "Invalid cursor")
        mvc.perform(get("/api/parent/prize-requests?cursor=zzz")).andExpect(status().isBadRequest)
    }
}
