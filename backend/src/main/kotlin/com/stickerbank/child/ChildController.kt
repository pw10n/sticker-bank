package com.stickerbank.child

import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/parent/children")
class ChildController(private val service: ChildService) {
    @GetMapping
    fun list(): List<ChildDto> = service.list()

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody input: ChildInput): ChildDto = service.create(input)

    @PutMapping("/{childId}")
    fun update(@PathVariable childId: Long, @Valid @RequestBody input: ChildInput): ChildDto = service.update(childId, input)

    @DeleteMapping("/{childId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable childId: Long) = service.delete(childId)
}
