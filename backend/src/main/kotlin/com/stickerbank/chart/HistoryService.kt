package com.stickerbank.chart

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FamilyClock
import com.stickerbank.revocation.RevocationService
import com.stickerbank.routine.RoutinePlanQuery
import org.springframework.stereotype.Service

@Service
class HistoryService(
    private val queries: ChartQueries,
    private val plans: RoutinePlanQuery,
    private val clock: FamilyClock,
    private val revocations: RevocationService,
) {
    fun history(childId: Long, fromRaw: String?, toRaw: String?): HistoryDto {
        val today = clock.today()
        val (from, to) = ChartRules.validateRange(fromRaw, toRaw, today)
        if (!queries.childExists(childId)) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
        val plan = plans.planForRange(childId, from, to)
        val completions = queries.completions(childId, from, to)
        val stickers = queries.stickers(childId, from, to)
        val revoked = revocations.revocationsFor(childId, from, to)
        val days = plan.map { (date, routines) ->
            val completed = completions[date].orEmpty()
            HistoryDayDto(
                date,
                routines.map {
                    val sticker = stickers[it.routineId to date]
                    val dto = ChartQueries.routineDto(it, date, today, completed, sticker)
                    HistoryRoutineDto(it.routineId, dto.name, dto.iconKey, dto.state, dto.doneCount, dto.taskCount, sticker?.stickerId)
                },
                revoked[date].orEmpty(),
            )
        }
        return HistoryDto(childId, from, to, days)
    }
}
