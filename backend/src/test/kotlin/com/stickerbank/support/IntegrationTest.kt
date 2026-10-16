package com.stickerbank.support

import com.stickerbank.dev.MySqlContainerConfig
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.test.context.ActiveProfiles
import org.testcontainers.junit.jupiter.Testcontainers

/** Full-context test against a Testcontainers MySQL. Skipped (never failed) when Docker is unavailable. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@SpringBootTest
@AutoConfigureMockMvc
@Import(MySqlContainerConfig::class, TestClockConfig::class)
@Testcontainers(disabledWithoutDocker = true)
@ActiveProfiles("test")
annotation class IntegrationTest
