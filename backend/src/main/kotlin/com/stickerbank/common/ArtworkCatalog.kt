package com.stickerbank.common

import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

enum class ArtworkUse(val json: String) {
    STICKER("sticker"),
    TASK("task"),
    ROUTINE("routine"),
    AVATAR("avatar"),
}

@Component
class ArtworkCatalog {
    private val usesByKey: Map<String, Set<String>> = load()

    fun exists(key: String, use: ArtworkUse): Boolean = usesByKey[key]?.contains(use.json) == true

    fun require(key: String, use: ArtworkUse, field: String) {
        if (!exists(key, use)) {
            throw DomainException(
                ErrorCode.VALIDATION_FAILED,
                properties = mapOf("fieldErrors" to listOf(FieldErrorDto(field, "Unknown artwork"))),
            )
        }
    }

    private fun load(): Map<String, Set<String>> {
        val resource = ClassPathResource("artwork/catalog.json")
        check(resource.exists()) { "classpath:artwork/catalog.json is missing" }
        val root = resource.inputStream.use { JsonMapper.builder().build().readTree(it) }
        return root.values().associate { node ->
            node.get("key").asString() to node.get("uses").values().map { it.asString() }.toSet()
        }
    }
}
