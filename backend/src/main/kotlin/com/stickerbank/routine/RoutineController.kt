package com.stickerbank.routine

import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.LocalDate

/** Parent Mode routine management. Bodies are validated by [RoutineInputValidator] (field errors, I-14), not bean validation. */
@RestController
class RoutineController(private val service: RoutineService) {
    @GetMapping("/api/parent/children/{childId}/routines")
    fun list(@PathVariable childId: Long): List<RoutineDto> = service.list(childId)

    @PostMapping("/api/parent/children/{childId}/routines")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable childId: Long, @RequestBody input: RoutineInput): RoutineSaveResultDto = service.create(childId, input)

    @PutMapping("/api/parent/children/{childId}/routines/order")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun reorder(@PathVariable childId: Long, @RequestBody request: RoutineOrderRequest) = service.reorder(childId, request)

    @GetMapping("/api/parent/routines/{routineId}")
    fun get(@PathVariable routineId: Long): RoutineDto = service.get(routineId)

    @PutMapping("/api/parent/routines/{routineId}")
    fun update(@PathVariable routineId: Long, @RequestBody input: RoutineInput): RoutineSaveResultDto = service.update(routineId, input)

    @DeleteMapping("/api/parent/routines/{routineId}")
    fun delete(@PathVariable routineId: Long): RoutineDeleteResultDto = service.delete(routineId)

    @PostMapping("/api/parent/routines/{routineId}/copy")
    @ResponseStatus(HttpStatus.CREATED)
    fun copy(@PathVariable routineId: Long, @RequestBody request: RoutineCopyRequest): RoutineDto = service.copy(routineId, request)

    @PutMapping("/api/parent/routines/{routineId}/skips/{date}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun skip(@PathVariable routineId: Long, @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) date: LocalDate) =
        service.skip(routineId, date)

    @DeleteMapping("/api/parent/routines/{routineId}/skips/{date}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun unskip(@PathVariable routineId: Long, @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) date: LocalDate) =
        service.unskip(routineId, date)
}
