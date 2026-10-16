package com.stickerbank.family

import com.stickerbank.common.ParentSessionCookie
import com.stickerbank.common.StickerBankProperties
import org.springframework.http.ResponseCookie
import java.time.Duration
import java.time.Instant

/** Pure session validity and touch-throttle rules. */
object ParentSessionRules {
    val TOUCH_THROTTLE: Duration = Duration.ofSeconds(30)

    fun isValid(now: Instant, lastSeenAt: Instant, expiresAt: Instant, idleTimeoutSeconds: Int): Boolean =
        now.isBefore(lastSeenAt.plusSeconds(idleTimeoutSeconds.toLong())) && now.isBefore(expiresAt)

    fun shouldTouch(now: Instant, lastSeenAt: Instant): Boolean = Duration.between(lastSeenAt, now) >= TOUCH_THROTTLE
}

/** Builds the `sb_parent` cookie: HttpOnly, SameSite=Strict, Path=/api. */
object ParentSessionCookies {
    fun issue(token: String, props: StickerBankProperties.ParentSession): ResponseCookie = build(token, props, props.absoluteMax)

    fun clear(props: StickerBankProperties.ParentSession): ResponseCookie = build("", props, Duration.ZERO)

    private fun build(value: String, props: StickerBankProperties.ParentSession, maxAge: Duration): ResponseCookie =
        ResponseCookie.from(ParentSessionCookie.NAME, value)
            .httpOnly(true)
            .secure(props.cookieSecure)
            .sameSite("Strict")
            .path("/api")
            .maxAge(maxAge)
            .build()
}
