package com.stickerbank.chart

import com.stickerbank.common.ChildLock
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import com.stickerbank.routine.RoutinePlanQuery
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Service
import java.time.LocalDate

/**
 * Ending the day (TDD 7.12, FR-6.10, TD-19). A routine still Ready to finish when its day ends is finished for the
 * child: its sticker is earned (`finish_mode = AUTO`, `earned_at` = the end of that day) and waits unclaimed in the
 * "Stickers to pick" tray.
 *
 * Nothing runs at midnight. Ended days are settled lazily, the first time anything touches the child afterwards, so a
 * server that was down at midnight gives the same result. `child.settled_through` is the watermark: days up to and
 * including it are never auto-finished again, which is what keeps a parent's later edit of a past day (FR-6.5) Ready to
 * finish until a parent taps I'm Done!.
 */
@Service
class DaySettlement(
    private val jdbc: JdbcClient,
    private val childLock: ChildLock,
    private val plans: RoutinePlanQuery,
    private val queries: ChartQueries,
    private val earner: StickerEarner,
    private val clock: FamilyClock,
) {
    private data class Mark(val settledThrough: LocalDate?)

    /** For callers that do not hold the child lock yet (chart and history reads). Cheap when nothing is waiting. */
    fun settleIfNeeded(childId: Long) {
        val mark = watermark(childId) ?: return
        if (!needsSettling(mark, yesterday())) return
        childLock.withChildLock(childId) { settleLocked(childId) }
    }

    /** The caller holds the child lock inside one transaction. Safe to call on every write; it re-reads the watermark. */
    fun settleLocked(childId: Long) {
        val zone = clock.zone()
        val yesterday = LocalDate.ofInstant(clock.now(), zone).minusDays(1)
        val mark = watermark(childId) ?: return
        if (!needsSettling(mark, yesterday)) return
        val settledThrough = mark.settledThrough
        // A child with no watermark has nothing waiting: a new child has no ended days, and before V5 the last task
        // earned the sticker at once, so no fully done routine was left waiting.
        if (settledThrough != null) finishEndedDays(childId, settledThrough.plusDays(1), yesterday)
        jdbc.sql("UPDATE child SET settled_through = ? WHERE id = ?").params(yesterday, childId).update()
    }

    private fun finishEndedDays(childId: Long, from: LocalDate, to: LocalDate) {
        val zone = clock.zone()
        val plan = plans.planForRange(childId, from, to)
        val completions = queries.completions(childId, from, to)
        val stickers = queries.stickers(childId, from, to)
        for ((date, routines) in plan) {
            val done = completions[date].orEmpty()
            for (routine in routines) {
                if (routine.skipped) continue
                if (stickers.containsKey(routine.routineId to date)) continue
                if (!routine.tasks.all { it.taskId in done }) continue
                earner.earn(
                    childId,
                    routine.routineId,
                    date,
                    routine.name,
                    routine.iconKey,
                    FinishMode.AUTO,
                    ChartRules.endOfDay(date, zone),
                )
            }
        }
    }

    private fun yesterday(): LocalDate = clock.today().minusDays(1)

    private fun needsSettling(mark: Mark, yesterday: LocalDate): Boolean = mark.settledThrough?.isBefore(yesterday) ?: true

    /** Null when the child does not exist, so callers fall through to their own 404. */
    private fun watermark(childId: Long): Mark? = jdbc.sql("SELECT settled_through FROM child WHERE id = ?")
        .param(childId)
        .query { rs, _ -> Mark(rs.getObject("settled_through", LocalDate::class.java)) }
        .list().firstOrNull()
}
