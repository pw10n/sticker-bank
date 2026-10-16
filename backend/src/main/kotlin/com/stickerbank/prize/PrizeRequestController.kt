package com.stickerbank.prize

import com.stickerbank.common.Actor
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
class PrizeRequestController(private val service: PrizeRequestService) {
    @GetMapping("/api/children/{childId}/prize-requests/pending")
    fun pending(@PathVariable childId: Long): PendingPrizeRequestDto = service.pending(childId)

    @PostMapping("/api/children/{childId}/prize-requests")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable childId: Long, @Valid @RequestBody body: PrizeRequestCreateRequest, actor: Actor): PrizeRequestDto =
        service.create(childId, body.stickerIds, actor)

    @PostMapping("/api/prize-requests/{requestId}/cancel")
    fun cancel(@PathVariable requestId: Long, actor: Actor): PrizeRequestDto = service.cancel(requestId, actor)

    @GetMapping("/api/parent/prize-requests")
    fun list(
        @RequestParam(required = false) status: List<PrizeRequestStatus>?,
        @RequestParam(required = false) childId: Long?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false, defaultValue = "50") limit: Int,
    ): PrizeRequestPageDto = service.list(status, childId, cursor, limit)

    @PostMapping("/api/parent/prize-requests/{requestId}/complete")
    fun complete(@PathVariable requestId: Long, @Valid @RequestBody body: PrizeCompleteRequest): PrizeRequestDto =
        service.complete(requestId, body)

    @PutMapping("/api/parent/prize-requests/{requestId}")
    fun edit(@PathVariable requestId: Long, @Valid @RequestBody body: PrizeEditRequest): PrizeRequestDto = service.edit(requestId, body)
}
