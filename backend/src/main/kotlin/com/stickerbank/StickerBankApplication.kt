package com.stickerbank

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import java.util.TimeZone

@SpringBootApplication
@ConfigurationPropertiesScan
class StickerBankApplication

fun main(args: Array<String>) {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    runApplication<StickerBankApplication>(*args)
}
