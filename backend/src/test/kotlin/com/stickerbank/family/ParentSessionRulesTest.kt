package com.stickerbank.family

import com.stickerbank.common.ParentSessionCookie
import com.stickerbank.common.StickerBankProperties
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.time.Duration
import java.time.Instant

class ParentSessionRulesTest {
    private val t0 = Instant.parse("2026-10-15T15:00:00Z")
    private val expires = t0.plus(Duration.ofHours(12))

    @Test
    fun `idle boundary is exclusive`() {
        assertThat(ParentSessionRules.isValid(t0.plusSeconds(299), t0, expires, 300)).isTrue()
        assertThat(ParentSessionRules.isValid(t0.plusSeconds(300), t0, expires, 300)).isFalse()
    }

    @Test
    fun `absolute boundary is exclusive`() {
        val lastSeen = expires.minusSeconds(10)
        assertThat(ParentSessionRules.isValid(expires.minusSeconds(1), lastSeen, expires, 300)).isTrue()
        assertThat(ParentSessionRules.isValid(expires, lastSeen, expires, 300)).isFalse()
    }

    @Test
    fun `touch is throttled to every 30 seconds`() {
        assertThat(ParentSessionRules.shouldTouch(t0.plusSeconds(29), t0)).isFalse()
        assertThat(ParentSessionRules.shouldTouch(t0.plusSeconds(30), t0)).isTrue()
    }

    @Test
    fun `issued cookie carries the security attributes`() {
        val header = ParentSessionCookies.issue("abc", StickerBankProperties.ParentSession(Duration.ofHours(12), true)).toString()
        assertThat(header).startsWith("${ParentSessionCookie.NAME}=abc")
            .contains("HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=43200")
    }

    @Test
    fun `secure flag follows the properties`() {
        val header = ParentSessionCookies.issue("abc", StickerBankProperties.ParentSession(Duration.ofHours(12), false)).toString()
        assertThat(header).doesNotContain("Secure")
    }

    @Test
    fun `cleared cookie expires immediately with the same attributes`() {
        val header = ParentSessionCookies.clear(StickerBankProperties.ParentSession(Duration.ofHours(12), true)).toString()
        assertThat(header).contains("Max-Age=0", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api")
    }
}
