package com.stickerbank.dev

import org.springframework.boot.devtools.restart.RestartScope
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.testcontainers.mysql.MySQLContainer
import org.testcontainers.utility.DockerImageName

@TestConfiguration(proxyBeanMethods = false)
class MySqlContainerConfig {
    @Bean
    @ServiceConnection
    @RestartScope
    fun mysql(): MySQLContainer = MySQLContainer(DockerImageName.parse("mysql:8.4"))
}
