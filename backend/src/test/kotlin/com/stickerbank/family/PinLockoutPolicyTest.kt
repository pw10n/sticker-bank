package com.stickerbank.family

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.time.Duration

class PinLockoutPolicyTest {
    private val policy = PinLockoutPolicy(
        5,
        listOf(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15), Duration.ofMinutes(60)),
    )

    @Test
    fun `failures one to four count down and the fifth locks`() {
        var attempts = 0
        val remaining = mutableListOf<Int>()
        repeat(4) {
            val f = policy.onFailure(attempts, 0)
            assertThat(f.lockFor).isNull()
            attempts = f.failedAttempts
            remaining += f.attemptsRemaining
        }
        assertThat(remaining).containsExactly(4, 3, 2, 1)
        val fifth = policy.onFailure(attempts, 0)
        assertThat(fifth.attemptsRemaining).isZero()
        assertThat(fifth.lockFor).isEqualTo(Duration.ofMinutes(1))
        assertThat(fifth.failedAttempts).isZero()
        assertThat(fifth.lockoutLevel).isEqualTo(1)
    }

    @Test
    fun `lock durations escalate and cap at the last cooldown`() {
        val durations = (0..5).map { policy.onFailure(4, it).lockFor }
        assertThat(durations).containsExactly(
            Duration.ofMinutes(1),
            Duration.ofMinutes(5),
            Duration.ofMinutes(15),
            Duration.ofMinutes(60),
            Duration.ofMinutes(60),
            Duration.ofMinutes(60),
        )
    }

    @Test
    fun `a failure at a higher level keeps the level until locking`() {
        val f = policy.onFailure(0, 2)
        assertThat(f.lockoutLevel).isEqualTo(2)
        assertThat(f.attemptsRemaining).isEqualTo(4)
    }
}
