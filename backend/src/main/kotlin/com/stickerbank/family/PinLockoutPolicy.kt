package com.stickerbank.family

import java.time.Duration

/** Pure PIN lockout rules (FR-8.7): count failures, escalate cooldowns, reset on success. */
class PinLockoutPolicy(private val attemptsBeforeLockout: Int, private val cooldowns: List<Duration>) {
    /** Outcome of one failed attempt: the new counters, and the lock duration when this attempt triggered a lockout. */
    data class Failure(val failedAttempts: Int, val lockoutLevel: Int, val attemptsRemaining: Int, val lockFor: Duration?)

    fun onFailure(failedAttempts: Int, lockoutLevel: Int): Failure {
        val failures = failedAttempts + 1
        if (failures < attemptsBeforeLockout) {
            return Failure(failures, lockoutLevel, attemptsBeforeLockout - failures, null)
        }
        val lock = cooldowns[minOf(lockoutLevel, cooldowns.size - 1)]
        return Failure(0, lockoutLevel + 1, 0, lock)
    }
}
