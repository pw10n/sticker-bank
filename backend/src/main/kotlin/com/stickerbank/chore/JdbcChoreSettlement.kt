package com.stickerbank.chore

import com.stickerbank.chart.ChartRules
import com.stickerbank.common.EarnSource
import com.stickerbank.common.FamilyClock
import com.stickerbank.common.FinishMode
import com.stickerbank.common.StickerEarner
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.time.LocalDate

/**
 * Finishing chores when their due date ends (TDD 7.12 step 5, FR-13.20). Called by DaySettlement inside the child
 * lock, after the routines and before the watermark moves, so this bean must not depend on DaySettlement or on any
 * service that does (ChartService, HistoryService, CompletionService).
 *
 * Deliberately not limited to the days being settled: a chore that is past due, fully checked and without a live
 * sticker can only be an automatic finish that has not been applied yet (a time zone change, or a pod on a pre-V6
 * build that moved the watermark), so it is finished whichever day it belongs to.
 */
@Component
class JdbcChoreSettlement(private val jdbc: JdbcClient, private val earner: StickerEarner, private val clock: FamilyClock) :
    ChoreSettlement {
    private data class DueChore(val id: Long, val name: String, val iconKey: String, val dueDate: LocalDate)

    override fun finishDueChoresLocked(childId: Long, today: LocalDate) {
        val due = jdbc.sql(
            """
            SELECT c.id, c.name, c.icon_key, c.due_date FROM chore c
             WHERE c.child_id = ? AND c.removed_at IS NULL AND c.due_date IS NOT NULL AND c.due_date < ?
               AND EXISTS (SELECT 1 FROM chore_task t WHERE t.chore_id = c.id)
               AND NOT EXISTS (SELECT 1 FROM chore_task t WHERE t.chore_id = c.id AND t.checked_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM live_sticker s WHERE s.chore_id = c.id)
             ORDER BY c.due_date, c.id
            """.trimIndent(),
        ).params(childId, today).query { rs, _ ->
            DueChore(rs.getLong("id"), rs.getString("name"), rs.getString("icon_key"), rs.getObject("due_date", LocalDate::class.java))
        }.list()
        if (due.isEmpty()) return
        val zone = clock.zone()
        for (chore in due) {
            earner.earn(
                childId,
                EarnSource.Chore(chore.id),
                chore.dueDate,
                chore.name,
                chore.iconKey,
                FinishMode.AUTO,
                ChartRules.endOfDay(chore.dueDate, zone),
            )
        }
    }
}
