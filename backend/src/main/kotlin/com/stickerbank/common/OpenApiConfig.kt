package com.stickerbank.common

import com.stickerbank.chart.RoutineDayState
import com.stickerbank.prize.PrizeCancelReason
import com.stickerbank.prize.PrizeRequestStatus
import com.stickerbank.sticker.DesignStatus
import com.stickerbank.sticker.StickerSource
import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.Operation
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.media.Content
import io.swagger.v3.oas.models.media.MediaType
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.responses.ApiResponses
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import io.swagger.v3.oas.models.servers.Server
import jakarta.validation.constraints.NotBlank
import org.springdoc.core.customizers.OpenApiCustomizer
import org.springframework.beans.factory.config.BeanDefinition
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider
import org.springframework.context.annotation.Configuration
import org.springframework.core.type.filter.RegexPatternTypeFilter
import java.util.regex.Pattern
import kotlin.reflect.KClass
import kotlin.reflect.full.primaryConstructor
import io.swagger.v3.oas.annotations.media.Schema as SchemaAnnotation

/**
 * Shapes springdoc's raw output into the API contract committed at frontend/src/api/openapi.json:
 * stable operationIds/tags, named enum schemas, `required` derived from Kotlin constructors,
 * ProblemDetail error responses and the parent-session security scheme.
 */
@Configuration(proxyBeanMethods = false)
class OpenApiConfig {
    /** A fixed server list keeps the spec independent of the request that fetched it. */
    @Bean
    fun stickerBankOpenApi(): OpenAPI = OpenAPI()
        .info(
            Info().title("Sticker Bank API").version("1.0.0").description(
                "Contract shared by the backend and frontend. All /api responses are Cache-Control: no-store. " +
                    "Every non-GET request must carry header `X-Sticker-Bank: 1`. " +
                    "Errors are application/problem+json (ProblemDetail).",
            ),
        )
        .servers(listOf(Server().url("/")))

    @Bean
    fun stickerBankOpenApiCustomizer(): OpenApiCustomizer = OpenApiCustomizer { api -> ContractShaper(api).apply() }
}

private val ENUMS: List<KClass<out Enum<*>>> =
    listOf(
        Weekday::class,
        Actor::class,
        RoutineDayState::class,
        StickerStatus::class,
        StickerSource::class,
        PrizeRequestStatus::class,
        PrizeCancelReason::class,
        DesignStatus::class,
        ErrorCode::class,
    )

private const val SCHEMAS = "#/components/schemas/"
private const val RESPONSES = "#/components/responses/"
private const val PROBLEM_JSON = "application/problem+json"
private const val STATE_CHANGING = "State-changing request: requires header `X-Sticker-Bank: 1`."

private val ERROR_DESCRIPTIONS =
    mapOf(
        "400" to "Validation failed (VALIDATION_FAILED, with fieldErrors)",
        "401" to "Parent session required (PARENT_SESSION_REQUIRED) or PIN incorrect (PIN_INCORRECT)",
        "403" to "Missing X-Sticker-Bank header (CSRF_HEADER_MISSING)",
        "404" to "Not found (NOT_FOUND)",
        "409" to "Conflict (see ProblemDetail.code)",
        "422" to "Unprocessable (see ProblemDetail.code)",
        "429" to "Too many PIN attempts (PIN_LOCKED, with retryAfterSeconds)",
    )

private data class OperationSpec(
    val method: String,
    val path: String,
    val operationId: String,
    val tag: String,
    val success: String,
    val errors: List<String>,
    val secured: Boolean,
    val summary: String,
)

/** METHOD|path|operationId|tag|success status|error statuses|S if parent session required|summary */
private val OPERATIONS: Map<String, OperationSpec> =
    """
        GET|/api/bootstrap|getBootstrap|family|200||-|App bootstrap state
        GET|/api/children/{childId}/days/{date}|getDailyChart|chart|200|400,404,422|-|Daily chart for a child
        PUT|/api/children/{childId}/days/{date}/tasks/{taskId}|completeTask|chart|200|403,404,409,422|-|Complete a task
        DELETE|/api/children/{childId}/days/{date}/tasks/{taskId}|uncompleteTask|chart|200|400,403,404,409,422|-|Un-complete a task, or revoke its sticker (parent, revokeSticker=true)
        GET|/api/stickers/{stickerId}/pick|getStickerPick|sticker|200|404|-|Get the pick (choices) for an earned sticker
        POST|/api/stickers/{stickerId}/pick|claimStickerPick|sticker|200|400,403,404,409,422|-|Claim one of the offered designs
        GET|/api/children/{childId}/stickers|getStickerBook|sticker|200|404|-|Sticker book page
        GET|/api/stickers/{stickerId}|getStickerDetail|sticker|200|404|-|Sticker detail
        GET|/api/children/{childId}/prize-requests/pending|getPendingPrizeRequest|prize|200|404|-|The child's pending prize request, if any
        POST|/api/children/{childId}/prize-requests|createPrizeRequest|prize|201|400,403,404,409|-|Create a prize request
        POST|/api/prize-requests/{requestId}/cancel|cancelPrizeRequest|prize|200|403,404,409|-|Cancel a pending prize request
        POST|/api/parent/pin|setupPin|family|201|400,403,409|-|First-time PIN setup (starts a parent session)
        PUT|/api/parent/pin|changePin|family|204|400,401,403,429|S|Change the PIN
        POST|/api/parent/session|unlock|family|200|400,401,403,409,429|-|Unlock parent mode with the PIN
        GET|/api/parent/session|getParentSession|family|200|401|S|Current parent session
        DELETE|/api/parent/session|lockParentMode|family|204|401,403|S|End the parent session
        POST|/api/parent/session/touch|touchParentSession|family|200|401,403|S|Extend the parent session idle timer
        GET|/api/parent/settings|getSettings|family|200|401|S|Family settings
        PUT|/api/parent/settings|updateSettings|family|200|400,401,403|S|Update family settings
        GET|/api/parent/children|listChildren|child|200|401|S|List children
        POST|/api/parent/children|createChild|child|201|400,401,403|S|Create a child
        PUT|/api/parent/children/{childId}|updateChild|child|200|400,401,403,404|S|Update a child
        DELETE|/api/parent/children/{childId}|deleteChild|child|204|401,403,404|S|Delete a child and everything they own
        GET|/api/parent/children/{childId}/routines|listRoutines|routine|200|401,404|S|List a child's routines
        POST|/api/parent/children/{childId}/routines|createRoutine|routine|201|400,401,403,404|S|Create a routine
        PUT|/api/parent/children/{childId}/routines/order|reorderRoutines|routine|204|400,401,403,404|S|Reorder a child's routines
        GET|/api/parent/routines/{routineId}|getRoutine|routine|200|401,404|S|Get a routine
        PUT|/api/parent/routines/{routineId}|updateRoutine|routine|200|400,401,403,404|S|Update a routine
        DELETE|/api/parent/routines/{routineId}|deleteRoutine|routine|200|401,403,404|S|Delete a routine (from tomorrow)
        POST|/api/parent/routines/{routineId}/copy|copyRoutine|routine|201|400,401,403,404|S|Copy a routine to a child
        PUT|/api/parent/routines/{routineId}/skips/{date}|addRoutineSkip|routine|204|401,403,404,409|S|Skip a routine on a day
        DELETE|/api/parent/routines/{routineId}/skips/{date}|removeRoutineSkip|routine|204|401,403,404|S|Remove a routine skip
        GET|/api/parent/children/{childId}/history|getHistory|history|200|400,401,404|S|Child history over a date range
        GET|/api/parent/library/designs|listDesigns|library|200|401|S|List sticker designs
        POST|/api/parent/library/designs|createDesign|library|201|400,401,403|S|Add a sticker design
        PUT|/api/parent/library/designs/{designId}|updateDesign|library|200|400,401,403,404|S|Update a sticker design
        DELETE|/api/parent/library/designs/{designId}|deleteDesign|library|204|401,403,404,409|S|Delete an unused sticker design
        PUT|/api/parent/library/designs/{designId}/status|setDesignStatus|library|200|400,401,403,404|S|Activate or retire a sticker design
        GET|/api/parent/library/categories|listCategories|library|200|401|S|List sticker categories
        POST|/api/parent/library/categories|createCategory|library|201|400,401,403|S|Create a category
        PUT|/api/parent/library/categories/{categoryId}|updateCategory|library|200|400,401,403,404|S|Update a category
        DELETE|/api/parent/library/categories/{categoryId}|deleteCategory|library|204|401,403,404|S|Delete a category
        GET|/api/parent/prize-requests|listPrizeRequests|prize|200|401|S|List prize requests
        POST|/api/parent/prize-requests/{requestId}/complete|completePrizeRequest|prize|200|400,401,403,404,409|S|Complete a pending prize request
        PUT|/api/parent/prize-requests/{requestId}|editPrizeRequest|prize|200|400,401,403,404,409|S|Edit a completed prize request
    """.trimIndent().lines().filter {
        it.isNotBlank()
    }.map { line ->
        val f = line.split("|")
        OperationSpec(f[0], f[1], f[2], f[3], f[4], f[5].split(",").filter { it.isNotEmpty() }, f[6] == "S", f[7])
    }.associateBy { "${it.method} ${it.path}" }

private class ContractShaper(private val api: OpenAPI) {
    private val components: Components = api.components ?: Components().also { api.components = it }
    private val dtoClasses: Map<String, KClass<*>> = scanDtos()

    fun apply() {
        addEnumSchemas()
        addProblemSchemas()
        addErrorResponses()
        components.addSecuritySchemes(
            "parentSession",
            SecurityScheme().type(SecurityScheme.Type.APIKEY).`in`(SecurityScheme.In.COOKIE).name(ParentSessionCookie.NAME),
        )
        shapeOperations()
        components.schemas?.forEach { (name, schema) -> shapeSchema(name, schema) }
        components.schemas?.filterKeys { name -> ENUMS.none { it.simpleName == name } }?.values?.forEach { walk(it) }
        api.paths?.values?.forEach { item ->
            item.readOperations().forEach { op ->
                op.parameters?.forEach { p -> p.schema?.let { walk(it) } }
                op.requestBody?.content?.values?.forEach { m -> m.schema?.let { walk(it) } }
                op.responses?.values?.forEach { r -> r.content?.values?.forEach { m -> m.schema?.let { walk(it) } } }
            }
        }
    }

    private fun scanDtos(): Map<String, KClass<*>> {
        val scanner = ClassPathScanningCandidateComponentProvider(false)
        scanner.addIncludeFilter(RegexPatternTypeFilter(Pattern.compile(".*(Dto|Request|Input)$")))
        val result = linkedMapOf<String, KClass<*>>()
        scanner.findCandidateComponents("com.stickerbank").mapNotNull(BeanDefinition::getBeanClassName).sorted().forEach {
            val kClass = Class.forName(it).kotlin
            result[kClass.simpleName ?: it] = kClass
        }
        return result
    }

    private fun ref(name: String): Schema<Any> = Schema<Any>().apply { `$ref` = SCHEMAS + name }

    private fun typed(type: String, format: String? = null): Schema<Any> = Schema<Any>().apply {
        types = linkedSetOf(type)
        this.format = format
    }

    private fun addEnumSchemas() {
        ENUMS.forEach { kClass ->
            val schema = typed("string")
            schema.enum = kClass.java.enumConstants.map { it.name }
            components.addSchemas(kClass.simpleName, schema)
        }
    }

    private fun addProblemSchemas() {
        val fieldError =
            Schema<Any>().apply {
                types = linkedSetOf("object")
                properties = linkedMapOf("field" to typed("string"), "message" to typed("string"))
                required = listOf("field", "message")
            }
        components.addSchemas("FieldErrorDto", fieldError)
        val problem =
            Schema<Any>().apply {
                types = linkedSetOf("object")
                properties =
                    linkedMapOf(
                        "type" to typed("string"),
                        "title" to typed("string"),
                        "status" to typed("integer", "int32"),
                        "detail" to typed("string"),
                        "code" to ref("ErrorCode"),
                        "attemptsRemaining" to typed("integer", "int32"),
                        "retryAfterSeconds" to typed("integer", "int32"),
                        "today" to typed("string", "date"),
                        "fieldErrors" to Schema<Any>().apply {
                            types = linkedSetOf("array")
                            items = ref("FieldErrorDto")
                        },
                        "sticker" to ref("ChartStickerDto"),
                        "instance" to typed("string"),
                    )
                required = listOf("title", "status", "code")
            }
        components.addSchemas("ProblemDetail", problem)
    }

    private fun addErrorResponses() {
        ERROR_DESCRIPTIONS.forEach { (status, description) ->
            val media = MediaType().schema(ref("ProblemDetail"))
            components.addResponses(
                "Problem$status",
                ApiResponse().description(description).content(Content().addMediaType(PROBLEM_JSON, media)),
            )
        }
    }

    private fun shapeOperations() {
        api.paths?.forEach { (path, item) ->
            item.readOperationsMap().forEach { (method, op) ->
                val spec = OPERATIONS["${method.name} $path"] ?: return@forEach
                op.operationId = spec.operationId
                op.tags = listOf(spec.tag)
                op.summary = spec.summary
                if (method.name != "GET") op.description = STATE_CHANGING
                // the Actor argument is resolved from the session cookie, never sent by clients
                op.parameters = op.parameters?.filterNot { it.`in` == "query" && it.name == "actor" }?.ifEmpty { null }
                if (path.contains("/days/{date}")) {
                    op.parameters?.firstOrNull { it.name == "date" }?.let { p ->
                        p.description = "YYYY-MM-DD or the literal 'today'"
                        p.schema?.pattern = "^(\\d{4}-\\d{2}-\\d{2}|today)$"
                    }
                }
                shapeQueryParameters(spec.operationId, op)
                if (spec.secured) op.security = listOf(SecurityRequirement().addList("parentSession"))
                shapeResponses(op, spec)
            }
        }
    }

    /** Controllers take lenient Kotlin types (to emit custom 400s); the contract documents the strict shapes. */
    private fun shapeQueryParameters(operationId: String, op: Operation) {
        fun param(name: String) = op.parameters?.firstOrNull { it.`in` == "query" && it.name == name }

        fun intRange(max: Int, default: Int) = typed("integer", "int32").apply {
            minimum = java.math.BigDecimal.ONE
            maximum = java.math.BigDecimal.valueOf(max.toLong())
            this.default = default
        }

        fun optional(name: String, schema: Schema<*>) {
            param(name)?.let {
                it.required = false
                it.schema = schema
            }
        }
        when (operationId) {
            "getHistory" ->
                listOf("from", "to").forEach { n ->
                    param(n)?.let {
                        it.required = true
                        it.schema = typed("string", "date")
                    }
                }
            "uncompleteTask" ->
                param("revokeSticker")?.let {
                    it.required = false
                    it.description =
                        "Parent only. true revokes the routine's earned sticker (TDD 7.11); " +
                        "without it an earned routine answers 409 REVOKE_CONFIRMATION_REQUIRED"
                    it.schema = typed("boolean").apply { default = false }
                }
            "getStickerBook" -> {
                optional("status", typed("string").apply { enum = listOf("AVAILABLE", "PENDING", "USED") })
                optional("cursor", typed("string"))
                optional("limit", intRange(200, 100))
            }
            "listPrizeRequests" -> {
                optional(
                    "status",
                    Schema<Any>().apply {
                        types = linkedSetOf("array")
                        items = ref("PrizeRequestStatus")
                    },
                )
                param("status")?.let {
                    it.style = io.swagger.v3.oas.models.parameters.Parameter.StyleEnum.FORM
                    it.explode = true
                }
                optional("childId", typed("integer", "int64"))
                optional("cursor", typed("string"))
                optional("limit", intRange(200, 50))
            }
        }
    }

    private fun shapeResponses(op: Operation, spec: OperationSpec) {
        val old = op.responses ?: ApiResponses()
        val original = old.values.firstOrNull { it.content != null || it.`$ref` == null }
        val success = ApiResponse().description(if (spec.success == "204") "No content" else "Success")
        if (spec.success != "204") {
            original?.content?.values?.firstOrNull()?.schema?.let { schema ->
                success.content = Content().addMediaType("application/json", MediaType().schema(schema))
            }
        }
        val responses = ApiResponses()
        responses.addApiResponse(spec.success, success)
        spec.errors.forEach { responses.addApiResponse(it, ApiResponse().`$ref`(RESPONSES + "Problem$it")) }
        op.responses = responses
    }

    /** Required = Kotlin constructor parameters without a default value; objects are closed. */
    private fun shapeSchema(name: String, schema: Schema<*>) {
        val props = schema.properties ?: return
        schema.additionalProperties = false
        val kClass = dtoClasses[name] ?: return
        val params = kClass.primaryConstructor?.parameters?.associateBy { it.name }
        val required =
            props.keys.filter { key ->
                val field = runCatching { kClass.java.getDeclaredField(key) }.getOrNull()
                val notRequired =
                    field?.getAnnotation(SchemaAnnotation::class.java)?.requiredMode == SchemaAnnotation.RequiredMode.NOT_REQUIRED
                !notRequired && (params?.get(key)?.isOptional?.not() ?: true)
            }
        schema.required = required.ifEmpty { null }
        props.forEach { (key, prop) ->
            val field = runCatching { kClass.java.getDeclaredField(key) }.getOrNull()
            if (field?.isAnnotationPresent(NotBlank::class.java) == true && (prop.minLength ?: 0) == 0) prop.minLength = 1
        }
    }

    /** Replaces inline enums by named references and drops noise constraints, recursively. */
    private fun walk(schema: Schema<*>) {
        val values = schema.enum
        if (schema.`$ref` == null && !values.isNullOrEmpty()) {
            val named = ENUMS.firstOrNull { e -> e.java.enumConstants.map { it.name } == values.map { it.toString() } }
            if (named != null) {
                val nullable = schema.types?.contains("null") == true
                schema.types = null
                schema.enum = null
                if (nullable) {
                    schema.oneOf = listOf(ref(named.simpleName!!), typed("null"))
                } else {
                    schema.`$ref` = SCHEMAS + named.simpleName
                }
            }
        }
        if (schema.maxItems == Int.MAX_VALUE) schema.maxItems = null
        if (schema.minItems == 0) schema.minItems = null
        if (schema.minLength == 0) schema.minLength = null
        schema.properties?.values?.forEach { walk(it) }
        schema.items?.let { walk(it) }
        (schema.additionalProperties as? Schema<*>)?.let { walk(it) }
        schema.oneOf?.forEach { walk(it) }
        schema.anyOf?.forEach { walk(it) }
        schema.allOf?.forEach { walk(it) }
    }
}
