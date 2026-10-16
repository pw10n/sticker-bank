package com.stickerbank.chart

import com.stickerbank.common.Actor
import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.routine.RoutinePlanQuery
import org.springframework.stereotype.Service

@Service
class ChartService(
    private val queries: ChartQueries,
    private val plans: RoutinePlanQuery,
    private val clock: FamilyClock,
    private val settlement: DaySettlement,
) {
    fun dailyChart(childId: Long, rawDate: String, actor: Actor = Actor.CHILD): DailyChartDto {
        val today = clock.today()
        val date = ChartRules.parsePastOrToday(rawDate, today)
        if (!queries.childExists(childId)) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
        // Routines left Ready to finish on an ended day are finished first (FR-6.10, TDD 7.12).
        settlement.settleIfNeeded(childId)
        val plan = plans.planFor(childId, date)
        val completed = queries.completions(childId, date, date)[date].orEmpty()
        val stickers = queries.stickers(childId, date, date)
        return DailyChartDto(
            childId = childId,
            date = date,
            isToday = date == today,
            routines = plan.map {
                ChartQueries.routineDto(it, date, today, completed, stickers[it.routineId to date], actor == Actor.PARENT)
            },
            unclaimedFromEarlierDays = queries.unclaimedBefore(childId, today),
        )
    }
}
