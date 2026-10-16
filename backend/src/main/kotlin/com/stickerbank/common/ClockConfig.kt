package com.stickerbank.common

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.security.SecureRandom
import java.time.Clock
import java.util.random.RandomGenerator

@Configuration(proxyBeanMethods = false)
class ClockConfig {
    @Bean
    fun clock(): Clock = Clock.systemUTC()

    @Bean
    fun pickRandom(): RandomGenerator = SecureRandom()
}
