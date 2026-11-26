package com.stickerbank.chore.stub

import com.stickerbank.chore.ChoreDto
import com.stickerbank.chore.ChoreInput
import com.stickerbank.chore.ChorePageDto
import com.stickerbank.chore.ChoreResultDto
import com.stickerbank.chore.ChoreService
import com.stickerbank.chore.ChoreSuggestionDto
import com.stickerbank.common.Actor
import org.springframework.stereotype.Service

/** Placeholder until the chore lifecycle lands: every call throws. Delete this file when the real bean is added. */
@Service
class ChoreServiceStub : ChoreService {
    private fun notBuilt(): Nothing = throw UnsupportedOperationException("ChoreService is not implemented yet")

    override fun assign(childId: Long, input: ChoreInput): ChoreDto = notBuilt()

    override fun save(choreId: Long, input: ChoreInput): ChoreDto = notBuilt()

    override fun remove(choreId: Long): Unit = notBuilt()

    override fun list(filter: String, childId: Long?, cursor: String?): ChorePageDto = notBuilt()

    override fun recent(): List<ChoreSuggestionDto> = notBuilt()

    override fun checkTask(childId: Long, choreId: Long, taskId: Long, actor: Actor): ChoreResultDto = notBuilt()

    override fun undoTask(
        childId: Long,
        choreId: Long,
        taskId: Long,
        actor: Actor,
        revokeSticker: Boolean,
        removeChore: Boolean,
        note: String?,
    ): ChoreResultDto = notBuilt()

    override fun finish(childId: Long, choreId: Long, actor: Actor): ChoreResultDto = notBuilt()
}
