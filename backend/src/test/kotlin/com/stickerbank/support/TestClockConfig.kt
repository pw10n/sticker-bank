package com.stickerbank.support

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Clock
import java.time.Instant
import java.util.Random
import java.util.random.RandomGenerator
import javax.sql.DataSource

@TestConfiguration(proxyBeanMethods = false)
class TestClockConfig {
    @Bean
    @Primary
    fun mutableClock(): MutableClock = MutableClock(Instant.parse("2026-10-15T15:00:00Z"))

    @Bean
    @Primary
    fun testPickRandom(): RandomGenerator = Random(42)

    @Bean
    fun dbCleaner(jdbc: JdbcClient, dataSource: DataSource): DbCleaner = DbCleaner(jdbc, dataSource)

    @Bean
    fun fixtures(jdbc: JdbcClient, clock: Clock): Fixtures = Fixtures(jdbc, clock)
}
