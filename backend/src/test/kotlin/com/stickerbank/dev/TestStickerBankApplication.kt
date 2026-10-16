package com.stickerbank.dev

import com.stickerbank.StickerBankApplication
import org.springframework.boot.fromApplication
import org.springframework.boot.with

fun main(args: Array<String>) {
    fromApplication<StickerBankApplication>()
        .with(MySqlContainerConfig::class, DemoDataSeeder::class)
        .run("--spring.profiles.active=dev", *args)
}
