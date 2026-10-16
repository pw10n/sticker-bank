package com.stickerbank.chart

import com.stickerbank.common.Actor
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
class ChartController(
    private val charts: ChartService,
    private val completions: CompletionService,
    private val historyService: HistoryService,
) {
    @GetMapping("/api/children/{childId}/days/{date}")
    fun day(@PathVariable childId: Long, @PathVariable date: String, actor: Actor): DailyChartDto = charts.dailyChart(childId, date, actor)

    @PutMapping("/api/children/{childId}/days/{date}/tasks/{taskId}")
    fun complete(@PathVariable childId: Long, @PathVariable date: String, @PathVariable taskId: Long, actor: Actor): TaskToggleResultDto =
        completions.complete(childId, date, taskId, actor)

    @PostMapping("/api/children/{childId}/days/{date}/routines/{routineId}/finish")
    fun finish(@PathVariable childId: Long, @PathVariable date: String, @PathVariable routineId: Long, actor: Actor): TaskToggleResultDto =
        completions.finish(childId, date, routineId, actor)

    @DeleteMapping("/api/children/{childId}/days/{date}/tasks/{taskId}")
    fun undo(
        @PathVariable childId: Long,
        @PathVariable date: String,
        @PathVariable taskId: Long,
        @RequestParam(defaultValue = "false") revokeSticker: Boolean,
        @RequestBody(required = false) @Valid body: RevokeStickerRequest?,
        actor: Actor,
    ): TaskToggleResultDto = completions.undo(childId, date, taskId, actor, revokeSticker, body?.note)

    @GetMapping("/api/parent/children/{childId}/history")
    fun history(
        @PathVariable childId: Long,
        @RequestParam(required = false) from: String?,
        @RequestParam(required = false) to: String?,
    ): HistoryDto = historyService.history(childId, from, to)
}
