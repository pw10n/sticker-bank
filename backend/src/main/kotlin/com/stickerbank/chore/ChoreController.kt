package com.stickerbank.chore

import com.stickerbank.chart.RevokeStickerRequest
import com.stickerbank.common.Actor
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/**
 * Chores (TDD 7.13, 8.2). The `/api/parent` paths need a parent session, which the parent interceptor enforces. The
 * `/api/children` paths are open, and a parent session only changes the [Actor]. Chore bodies are validated by the
 * service (field errors, like a routine save), not by bean validation.
 */
@RestController
class ChoreController(private val chores: ChoreService) {
    @PostMapping("/api/parent/children/{childId}/chores")
    @ResponseStatus(HttpStatus.CREATED)
    fun assign(@PathVariable childId: Long, @RequestBody input: ChoreInput): ChoreDto = chores.assign(childId, input)

    @GetMapping("/api/parent/chores")
    fun list(
        @RequestParam filter: String,
        @RequestParam(required = false) childId: Long?,
        @RequestParam(required = false) cursor: String?,
    ): ChorePageDto = chores.list(filter, childId, cursor)

    @GetMapping("/api/parent/chores/recent")
    fun recent(): List<ChoreSuggestionDto> = chores.recent()

    @PutMapping("/api/parent/chores/{choreId}")
    fun save(@PathVariable choreId: Long, @RequestBody input: ChoreInput): ChoreDto = chores.save(choreId, input)

    @DeleteMapping("/api/parent/chores/{choreId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable choreId: Long) = chores.remove(choreId)

    @PutMapping("/api/children/{childId}/chores/{choreId}/tasks/{taskId}")
    fun checkTask(@PathVariable childId: Long, @PathVariable choreId: Long, @PathVariable taskId: Long, actor: Actor): ChoreResultDto =
        chores.checkTask(childId, choreId, taskId, actor)

    @DeleteMapping("/api/children/{childId}/chores/{choreId}/tasks/{taskId}")
    fun undoTask(
        @PathVariable childId: Long,
        @PathVariable choreId: Long,
        @PathVariable taskId: Long,
        @RequestParam(defaultValue = "false") revokeSticker: Boolean,
        @RequestParam(defaultValue = "false") removeChore: Boolean,
        @RequestBody(required = false) @Valid body: RevokeStickerRequest?,
        actor: Actor,
    ): ChoreResultDto = chores.undoTask(childId, choreId, taskId, actor, revokeSticker, removeChore, body?.note)

    @PostMapping("/api/children/{childId}/chores/{choreId}/finish")
    fun finish(@PathVariable childId: Long, @PathVariable choreId: Long, actor: Actor): ChoreResultDto =
        chores.finish(childId, choreId, actor)
}
