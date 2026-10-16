package com.stickerbank.sticker.library

import com.stickerbank.sticker.CategoryDto
import com.stickerbank.sticker.CategoryInput
import com.stickerbank.sticker.DesignDto
import com.stickerbank.sticker.DesignInput
import com.stickerbank.sticker.DesignStatus
import com.stickerbank.sticker.DesignStatusRequest
import com.stickerbank.sticker.LibraryDto
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/parent/library/designs")
class LibraryController(private val service: LibraryService) {
    @GetMapping
    fun list(
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) status: DesignStatus?,
        @RequestParam(required = false) categoryId: Long?,
    ): LibraryDto = service.list(q, status, categoryId)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody input: DesignInput): DesignDto = service.create(input)

    @PutMapping("/{designId}")
    fun update(@PathVariable designId: Long, @Valid @RequestBody input: DesignInput): DesignDto = service.update(designId, input)

    @DeleteMapping("/{designId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable designId: Long) = service.delete(designId)

    @PutMapping("/{designId}/status")
    fun setStatus(@PathVariable designId: Long, @RequestBody request: DesignStatusRequest): DesignDto =
        service.setStatus(designId, request.status)
}

@RestController
@RequestMapping("/api/parent/library/categories")
class StickerCategoryController(private val service: LibraryService) {
    @GetMapping
    fun list(): List<CategoryDto> = service.categories()

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody input: CategoryInput): CategoryDto = service.createCategory(input)

    @PutMapping("/{categoryId}")
    fun update(@PathVariable categoryId: Long, @Valid @RequestBody input: CategoryInput): CategoryDto =
        service.updateCategory(categoryId, input)

    @DeleteMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable categoryId: Long) = service.deleteCategory(categoryId)
}
