package com.stickerbank.common

import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

data class SampleBody(@field:NotBlank @field:Size(max = 5) val name: String)

@RestController
class SampleController {
    @GetMapping("/api/test/domain")
    fun domain(): String =
        throw DomainException(ErrorCode.PIN_LOCKED, "Slow down", mapOf("retryAfterSeconds" to 60, "attemptsRemaining" to 0))

    @GetMapping("/api/test/locked")
    fun locked(): String = throw DomainException(ErrorCode.ROUTINE_LOCKED)

    @PostMapping("/api/test/body")
    fun body(@Valid @RequestBody body: SampleBody): String = body.name

    @GetMapping("/api/test/number")
    fun number(@RequestParam n: Int): Int = n
}

class ProblemDetailAdviceTest {
    private lateinit var mvc: MockMvc

    @BeforeEach
    fun setUp() {
        mvc = MockMvcBuilders.standaloneSetup(SampleController()).setControllerAdvice(ProblemDetailAdvice()).build()
    }

    @Test
    fun `domain exception becomes problem json with code and extra properties`() {
        mvc.perform(get("/api/test/domain"))
            .andExpect(status().isTooManyRequests)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.code").value("PIN_LOCKED"))
            .andExpect(jsonPath("$.status").value(429))
            .andExpect(jsonPath("$.title").value(ErrorCode.PIN_LOCKED.title))
            .andExpect(jsonPath("$.detail").value("Slow down"))
            .andExpect(jsonPath("$.retryAfterSeconds").value(60))
            .andExpect(jsonPath("$.attemptsRemaining").value(0))
    }

    @Test
    fun `default detail is the friendly title`() {
        mvc.perform(get("/api/test/locked"))
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.title").value("This routine is finished for today"))
            .andExpect(jsonPath("$.detail").value("This routine is finished for today"))
    }

    @Test
    fun `bean validation failures list field errors`() {
        mvc.perform(post("/api/test/body").contentType(MediaType.APPLICATION_JSON).content("""{"name":"too long name"}"""))
            .andExpect(status().isBadRequest)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
            .andExpect(jsonPath("$.fieldErrors[0].message").isNotEmpty)
    }

    @Test
    fun `unreadable body is a validation failure`() {
        mvc.perform(post("/api/test/body").contentType(MediaType.APPLICATION_JSON).content("{not json"))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").isNotEmpty)
    }

    @Test
    fun `type mismatch and missing parameters are validation failures`() {
        mvc.perform(get("/api/test/number").param("n", "abc"))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[0].field").value("n"))
        mvc.perform(get("/api/test/number"))
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.fieldErrors[0].field").value("n"))
    }

    @Test
    fun `unknown api path is NOT_FOUND`() {
        mvc.perform(get("/api/test/nothing-here"))
            .andExpect(status().isNotFound)
    }
}
