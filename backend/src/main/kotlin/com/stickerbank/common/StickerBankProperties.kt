package com.stickerbank.common

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties("sticker-bank")
data class StickerBankProperties(val parentSession: ParentSession = ParentSession(), val pin: Pin = Pin()) {
    data class ParentSession(val absoluteMax: Duration = Duration.ofHours(12), val cookieSecure: Boolean = true)

    data class Pin(
        val attemptsBeforeLockout: Int = 5,
        val cooldowns: List<Duration> =
            listOf(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15), Duration.ofMinutes(60)),
    )
}
