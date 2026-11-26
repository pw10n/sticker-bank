package com.stickerbank.chore.stub

import com.stickerbank.chore.ChoreResultDto
import com.stickerbank.chore.ChoreRevoker
import org.springframework.stereotype.Component

/** Placeholder until the chore revoke lands: every call throws. Delete this file when the real bean is added. */
@Component
class ChoreRevokerStub : ChoreRevoker {
    override fun revokeLocked(childId: Long, choreId: Long, taskId: Long, note: String?, removeChore: Boolean): ChoreResultDto =
        throw UnsupportedOperationException("ChoreRevoker is not implemented yet")
}
