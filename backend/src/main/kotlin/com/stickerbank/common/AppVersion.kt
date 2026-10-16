package com.stickerbank.common

import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.info.BuildProperties
import org.springframework.stereotype.Component

@Component
class AppVersion(buildProperties: ObjectProvider<BuildProperties>) {
    val value: String = buildProperties.ifAvailable?.version ?: "dev"
}
