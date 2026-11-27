package com.stickerbank.chore

import com.ninjasquad.springmockk.MockkBean
import com.stickerbank.common.Actor
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.ParentSessionReader
import io.mockk.every
import io.mockk.verify
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant
import java.time.LocalDate

@WebMvcTest(ChoreController::class)
class ChoreControllerWebTest {
    @Autowired lateinit var mvc: MockMvc

    @MockkBean lateinit var chores: ChoreService

    @MockkBean lateinit var sessions: ParentSessionReader

    private val body = """{"name":"Tidy","iconKey":"broom","dueDate":null,"tasks":[{"label":"A","iconKey":"basket"}]}"""
    private val taskPath = "/api/children/1/chores/2/tasks/3"

    private val dto = ChoreDto(
        2, 1, "Tidy", "broom", null, ChoreState.NOT_STARTED, 0, 1, emptyList(), null, null, Instant.parse("2026-10-15T15:00:00Z"),
    )
    private val chartChore = ChartChoreDto(2, "Tidy", "broom", LocalDate.of(2026, 10, 15), ChoreState.IN_PROGRESS, 1, 2, emptyList(), null)

    @Test
    fun `assign is 201 and needs a parent session`() {
        every { sessions.hasValidSession(any()) } returns false
        mvc.perform(
            post("/api/parent/children/1/chores").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body),
        )
            .andExpect(status().isUnauthorized)
        every { sessions.hasValidSession(any()) } returns true
        every { chores.assign(1, any()) } returns dto
        mvc.perform(
            post("/api/parent/children/1/chores").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body),
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.choreId").value(2))
    }

    @Test
    fun `assign validation failure is 400 with field errors`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.assign(1, any()) } throws
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto("name", "bad"))))
        mvc.perform(
            post("/api/parent/children/1/chores").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
    }

    @Test
    fun `limit reached is 409`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.assign(1, any()) } throws DomainException(ErrorCode.CHORE_LIMIT_REACHED)
        mvc.perform(
            post("/api/parent/children/1/chores").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body),
        )
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("CHORE_LIMIT_REACHED"))
    }

    @Test
    fun `list passes the raw filter, child and cursor`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.list("closed", 4, "abc") } returns ChorePageDto(listOf(dto), "next")
        mvc.perform(get("/api/parent/chores?filter=closed&childId=4&cursor=abc"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.nextCursor").value("next"))
        every { chores.list("weird", null, null) } throws
            DomainException(ErrorCode.VALIDATION_FAILED, properties = mapOf("fieldErrors" to listOf(FieldErrorDto("filter", "bad"))))
        mvc.perform(get("/api/parent/chores?filter=weird")).andExpect(status().isBadRequest)
    }

    @Test
    fun `recent, save and remove`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.recent() } returns listOf(ChoreSuggestionDto("Tidy", "broom", listOf(ChoreSuggestionTaskDto("A", "basket"))))
        mvc.perform(get("/api/parent/chores/recent")).andExpect(status().isOk).andExpect(jsonPath("$[0].tasks[0].label").value("A"))
        every { chores.save(2, any()) } returns dto
        mvc.perform(put("/api/parent/chores/2").header("X-Sticker-Bank", "1").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk)
        every { chores.remove(2) } returns Unit
        mvc.perform(delete("/api/parent/chores/2").header("X-Sticker-Bank", "1")).andExpect(status().isNoContent)
    }

    @Test
    fun `locked chore is 409`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.remove(2) } throws DomainException(ErrorCode.CHORE_LOCKED)
        mvc.perform(delete("/api/parent/chores/2").header("X-Sticker-Bank", "1"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("CHORE_LOCKED"))
    }

    @Test
    fun `check task is open and the actor follows the session`() {
        every { sessions.hasValidSession(any()) } returns false
        every { chores.checkTask(1, 2, 3, Actor.CHILD) } returns ChoreResultDto(chartChore, null, null)
        mvc.perform(put(taskPath).header("X-Sticker-Bank", "1")).andExpect(status().isOk).andExpect(jsonPath("$.chore.choreId").value(2))
        every { sessions.hasValidSession(any()) } returns true
        every { chores.checkTask(1, 2, 3, Actor.PARENT) } returns ChoreResultDto(chartChore, null, null)
        mvc.perform(put(taskPath).header("X-Sticker-Bank", "1")).andExpect(status().isOk)
        verify { chores.checkTask(1, 2, 3, Actor.PARENT) }
    }

    @Test
    fun `missed and not found map to 409 and 404`() {
        every { sessions.hasValidSession(any()) } returns false
        every { chores.checkTask(1, 2, 3, Actor.CHILD) } throws DomainException(ErrorCode.CHORE_MISSED)
        mvc.perform(
            put(taskPath).header("X-Sticker-Bank", "1"),
        ).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("CHORE_MISSED"))
        every { chores.finish(1, 2, Actor.CHILD) } throws DomainException(ErrorCode.NOT_FOUND)
        mvc.perform(post("/api/children/1/chores/2/finish").header("X-Sticker-Bank", "1")).andExpect(status().isNotFound)
    }

    @Test
    fun `undo passes the flags and the note`() {
        every { sessions.hasValidSession(any()) } returns true
        every { chores.undoTask(1, 2, 3, Actor.PARENT, true, true, "oops") } returns ChoreResultDto(null, null, null)
        mvc.perform(
            delete("$taskPath?revokeSticker=true&removeChore=true").header("X-Sticker-Bank", "1")
                .contentType(MediaType.APPLICATION_JSON).content("""{"note":"oops"}"""),
        ).andExpect(status().isOk).andExpect(jsonPath("$.chore").doesNotExist())
        every { chores.undoTask(1, 2, 3, Actor.PARENT, false, false, null) } returns ChoreResultDto(chartChore, null, null)
        mvc.perform(delete(taskPath).header("X-Sticker-Bank", "1")).andExpect(status().isOk)
    }

    @Test
    fun `finish is open`() {
        every { sessions.hasValidSession(any()) } returns false
        every { chores.finish(1, 2, Actor.CHILD) } returns ChoreResultDto(chartChore, null, null)
        mvc.perform(post("/api/children/1/chores/2/finish").header("X-Sticker-Bank", "1")).andExpect(status().isOk)
    }
}
