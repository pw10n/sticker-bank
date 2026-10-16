package com.stickerbank.flows

import com.jayway.jsonpath.JsonPath
import com.stickerbank.support.DbCleaner
import com.stickerbank.support.Fixtures
import com.stickerbank.support.MutableClock
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.BeforeEach
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.Instant

/**
 * Shared plumbing for cross-module flow tests. Everything goes through the HTTP API (MockMvc);
 * only seeding of past-dated data and assertions on stored rows touch the database.
 * Subclasses carry @IntegrationTest.
 */
abstract class FlowTestBase {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var fixtures: Fixtures

    @Autowired lateinit var dbCleaner: DbCleaner

    @Autowired lateinit var clock: MutableClock

    @Autowired lateinit var jdbc: JdbcClient

    @BeforeEach
    fun resetState() {
        dbCleaner.reset()
        clock.set(Instant.parse("2026-10-15T15:00:00Z"))
    }

    protected fun read(result: ResultActions): String = result.andReturn().response.contentAsString

    protected fun long(body: String, path: String): Long = (JsonPath.read<Any>(body, path) as Number).toLong()

    protected fun text(body: String, path: String): String = JsonPath.read<String>(body, path)

    protected fun longs(body: String, path: String): List<Long> = JsonPath.read<List<Any>>(body, path).map { (it as Number).toLong() }

    /** Sends a state-changing request carrying the CSRF header, a JSON body and an optional parent cookie. */
    protected fun send(method: String, path: String, body: String? = null, cookie: Cookie? = null): ResultActions {
        val builder =
            when (method) {
                "POST" -> post(path)
                "PUT" -> put(path)
                "DELETE" -> delete(path)
                else -> error("unsupported method $method")
            }.header("X-Sticker-Bank", "1")
        if (body != null) builder.contentType(MediaType.APPLICATION_JSON).content(body)
        if (cookie != null) builder.cookie(cookie)
        return mvc.perform(builder)
    }

    protected fun fetch(path: String, cookie: Cookie? = null): ResultActions {
        val builder = get(path)
        if (cookie != null) builder.cookie(cookie)
        return mvc.perform(builder)
    }

    /** First-run PIN setup through the real endpoint; returns the parent session cookie it starts. */
    protected fun setupParent(pin: String = "1234", timeZone: String = "UTC"): Cookie {
        val result = send("POST", "/api/parent/pin", """{"pin":"$pin","timeZone":"$timeZone"}""").andExpect(status().isCreated)
        return requireNotNull(result.andReturn().response.getCookie("sb_parent"))
    }

    /** A parent session without going through the API (PIN row + session row). */
    protected fun seededParent(): Cookie {
        fixtures.setPin()
        return fixtures.parentCookie(fixtures.createParentSession())
    }

    protected fun createChildViaApi(cookie: Cookie, name: String = "Jane Doe"): Long {
        val body = """{"name":"$name","avatarKey":"cat-face","themeColor":"#FFB703"}"""
        return long(read(send("POST", "/api/parent/children", body, cookie).andExpect(status().isCreated)), "$.id")
    }

    protected data class ApiRoutine(val id: Long, val taskIds: List<Long>)

    protected fun createRoutineViaApi(
        cookie: Cookie,
        childId: Long,
        name: String = "Morning Routine",
        labels: List<String> = listOf("Brush teeth", "Get dressed"),
    ): ApiRoutine {
        val tasks = labels.joinToString(",") { """{"label":"$it","iconKey":"toothbrush"}""" }
        val body = """{"name":"$name","iconKey":"sun","color":null,"tasks":[$tasks]}"""
        val saved = read(send("POST", "/api/parent/children/$childId/routines", body, cookie).andExpect(status().isCreated))
        return ApiRoutine(long(saved, "$.routine.id"), longs(saved, "$.routine.tasks[*].id"))
    }

    protected fun completeTask(childId: Long, date: String, taskId: Long, cookie: Cookie? = null): ResultActions =
        send("PUT", "/api/children/$childId/days/$date/tasks/$taskId", null, cookie)

    protected fun claim(stickerId: Long, designId: Long): ResultActions =
        send("POST", "/api/stickers/$stickerId/pick", """{"designId":$designId}""")

    protected fun count(sql: String, vararg params: Any): Long = jdbc.sql(sql).params(params.toList()).query(Long::class.java).single()
}
