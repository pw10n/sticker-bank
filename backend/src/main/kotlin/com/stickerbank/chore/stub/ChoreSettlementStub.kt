package com.stickerbank.chore.stub

import com.stickerbank.chore.ChoreSettlement
import org.springframework.stereotype.Component
import java.time.LocalDate

/** Placeholder until due-date settlement lands: finishes nothing. Delete this file when the real bean is added. */
@Component
class ChoreSettlementStub : ChoreSettlement {
    override fun finishDueChoresLocked(childId: Long, today: LocalDate) = Unit
}
