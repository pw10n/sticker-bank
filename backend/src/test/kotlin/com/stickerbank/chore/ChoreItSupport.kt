package com.stickerbank.chore

import com.jayway.jsonpath.JsonPath
import com.stickerbank.chart.RevokedStickerDto
import com.stickerbank.common.StickerStatus
import com.stickerbank.support.Fixtures
import jakarta.servlet.http.Cookie
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import java.time.LocalDate

/** A task in a request body: [id] only on an edit. */
data class TaskBody(val label: String, val icon: String = "basket", val id: Long? = null)

/** HTTP helpers for the chore ITs. Create it after the database was reset. */
class ChoreApi(private val mvc: MockMvc, fixtures: Fixtures) {
    val parent: Cookie

    init {
        fixtures.setPin()
        parent = fixtures.parentCookie(fixtures.createParentSession())
    }

    fun body(
        name: String = "Tidy up",
        icon: String = "broom",
        due: LocalDate? = null,
        tasks: List<TaskBody> = listOf(TaskBody("Blocks away"), TaskBody("Books away", "open-book")),
        alreadyDone: Boolean? = null,
    ): String {
        val taskJson = tasks.joinToString(",") {
            """{"id":${it.id ?: "null"},"label":"${it.label}","iconKey":"${it.icon}"}"""
        }
        val done = alreadyDone?.let { ""","alreadyDone":$it""" } ?: ""
        return """{"name":"$name","iconKey":"$icon","dueDate":${due?.let { "\"$it\"" } ?: "null"},"tasks":[$taskJson]$done}"""
    }

    fun assign(childId: Long, body: String = body()): ResultActions = mvc.perform(
        post("/api/parent/children/$childId/chores").cookie(parent).header("X-Sticker-Bank", "1")
            .contentType(MediaType.APPLICATION_JSON).content(body),
    )

    fun save(choreId: Long, body: String): ResultActions = mvc.perform(
        put("/api/parent/chores/$choreId").cookie(parent).header("X-Sticker-Bank", "1")
            .contentType(MediaType.APPLICATION_JSON).content(body),
    )

    fun remove(choreId: Long): ResultActions =
        mvc.perform(delete("/api/parent/chores/$choreId").cookie(parent).header("X-Sticker-Bank", "1"))

    fun list(query: String): ResultActions = mvc.perform(get("/api/parent/chores?$query").cookie(parent))

    fun recent(): ResultActions = mvc.perform(get("/api/parent/chores/recent").cookie(parent))

    fun check(childId: Long, choreId: Long, taskId: Long, asParent: Boolean = false): ResultActions = mvc.perform(
        put("/api/children/$childId/chores/$choreId/tasks/$taskId").header("X-Sticker-Bank", "1").also { if (asParent) it.cookie(parent) },
    )

    fun undo(childId: Long, choreId: Long, taskId: Long, asParent: Boolean = false, query: String = ""): ResultActions = mvc.perform(
        delete("/api/children/$childId/chores/$choreId/tasks/$taskId$query").header("X-Sticker-Bank", "1")
            .also { if (asParent) it.cookie(parent) },
    )

    fun finish(childId: Long, choreId: Long, asParent: Boolean = false): ResultActions = mvc.perform(
        post("/api/children/$childId/chores/$choreId/finish").header("X-Sticker-Bank", "1").also { if (asParent) it.cookie(parent) },
    )

    fun chart(childId: Long, date: String = "today", asParent: Boolean = false): ResultActions = mvc.perform(
        get("/api/children/$childId/days/$date").also { if (asParent) it.cookie(parent) },
    )

    fun history(childId: Long, from: String, to: String): ResultActions =
        mvc.perform(get("/api/parent/children/$childId/history?from=$from&to=$to").cookie(parent))
}

fun ResultActions.json(): String = andReturn().response.contentAsString

fun <T> ResultActions.read(path: String): T = JsonPath.read(json(), path)

/**
 * Stands in for B2's real revoker in the lifecycle ITs: it clears the task's check, revokes the live sticker and, with
 * `removeChore`, removes the chore, like TDD 7.13 describes. Register with `@Import`.
 */
@TestConfiguration(proxyBeanMethods = false)
class FakeChoreRevokerConfig {
    @Bean
    @Primary
    fun fakeChoreRevoker(jdbc: JdbcClient): ChoreRevoker = object : ChoreRevoker {
        override fun revokeLocked(childId: Long, choreId: Long, taskId: Long, note: String?, removeChore: Boolean): RevokedStickerDto? {
            val sticker = jdbc.sql("SELECT id, status FROM live_sticker WHERE chore_id = ?").param(choreId)
                .query { rs, _ -> rs.getLong("id") to StickerStatus.valueOf(rs.getString("status")) }.list().firstOrNull()
                ?: return null
            jdbc.sql("UPDATE chore_task SET checked_at = NULL, checked_by = NULL WHERE id = ?").param(taskId).update()
            jdbc.sql("UPDATE sticker SET status = 'REVOKED' WHERE id = ?").param(sticker.first).update()
            if (removeChore) jdbc.sql("UPDATE chore SET removed_at = UTC_TIMESTAMP(3) WHERE id = ?").param(choreId).update()
            return RevokedStickerDto(sticker.first, sticker.second, null, false)
        }
    }
}
