package com.stickerbank.chore.stub

import com.stickerbank.chore.ChartChoreDto
import com.stickerbank.chore.ChoreReader
import org.springframework.stereotype.Component
import java.time.LocalDate

/** Placeholder until the chore reader lands: no chores on any day. Delete this file when the real bean is added. */
@Component
class ChoreReaderStub : ChoreReader {
    override fun choresByDay(
        childId: Long,
        from: LocalDate,
        to: LocalDate,
        today: LocalDate,
        parent: Boolean,
    ): Map<LocalDate, List<ChartChoreDto>> = emptyMap()
}
