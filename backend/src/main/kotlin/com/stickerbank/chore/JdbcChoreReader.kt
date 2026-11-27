package com.stickerbank.chore

import org.springframework.stereotype.Component
import java.time.LocalDate

/**
 * The chores on each chart day (TDD 7.3). It uses the `today` it is given and never settles: ChartService and
 * HistoryService do that first. So it must not depend on either of them, or on DaySettlement.
 */
@Component
class JdbcChoreReader(private val queries: ChoreQueries) : ChoreReader {
    override fun choresByDay(
        childId: Long,
        from: LocalDate,
        to: LocalDate,
        today: LocalDate,
        parent: Boolean,
    ): Map<LocalDate, List<ChartChoreDto>> {
        val byDay = linkedMapOf<LocalDate, MutableList<ChartChoreDto>>()
        // Already ordered by created_at, then id.
        for (chore in queries.candidatesForChart(childId, from, to, today)) {
            val state = chore.state(today)
            val day = ChoreRules.chartDay(state, chore.sticker?.chartDate, chore.dueDate, today)
            if (day == null || day.isBefore(from) || day.isAfter(to)) continue
            byDay.getOrPut(day) { mutableListOf() } += chore.toChartDto(today, parent)
        }
        return byDay
    }
}
