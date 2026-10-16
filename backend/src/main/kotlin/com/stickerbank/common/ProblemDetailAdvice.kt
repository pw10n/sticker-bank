package com.stickerbank.common

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.ConstraintViolationException
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.dao.EmptyResultDataAccessException
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.validation.method.ParameterErrors
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.resource.NoResourceFoundException
import tools.jackson.core.JacksonException

/**
 * The only controller advice in the application. Highest precedence so it wins over Spring's own
 * problem-details advice (enabled by spring.mvc.problemdetails.enabled).
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
class ProblemDetailAdvice {
    @ExceptionHandler(DomainException::class)
    fun domain(e: DomainException): ResponseEntity<ProblemDetail> = problem(e.code, e.message, e.properties)

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalidBody(e: MethodArgumentNotValidException): ResponseEntity<ProblemDetail> = validation(
        e.bindingResult.fieldErrors.map { FieldErrorDto(it.field, it.defaultMessage ?: "Invalid value") } +
            e.bindingResult.globalErrors.map { FieldErrorDto(it.objectName, it.defaultMessage ?: "Invalid value") },
    )

    @ExceptionHandler(HandlerMethodValidationException::class)
    fun invalidParameters(e: HandlerMethodValidationException): ResponseEntity<ProblemDetail> {
        val errors = e.parameterValidationResults.flatMap { result ->
            if (result is ParameterErrors) {
                result.fieldErrors.map { FieldErrorDto(it.field, it.defaultMessage ?: "Invalid value") }
            } else {
                val name = result.methodParameter.parameterName ?: "parameter"
                result.resolvableErrors.map { FieldErrorDto(name, it.defaultMessage ?: "Invalid value") }
            }
        }
        return validation(errors)
    }

    @ExceptionHandler(ConstraintViolationException::class)
    fun constraintViolation(e: ConstraintViolationException): ResponseEntity<ProblemDetail> = validation(
        e.constraintViolations.map {
            FieldErrorDto(it.propertyPath.lastOrNull()?.name ?: it.propertyPath.toString(), it.message)
        },
    )

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(e: HttpMessageNotReadableException): ResponseEntity<ProblemDetail> {
        val path = (e.cause as? JacksonException)?.path.orEmpty()
            .joinToString(".") { it.propertyName ?: "[${it.index}]" }
            .replace(".[", "[")
        return validation(listOf(FieldErrorDto(path.ifBlank { "body" }, "Malformed or incomplete request body")))
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException::class)
    fun typeMismatch(e: MethodArgumentTypeMismatchException): ResponseEntity<ProblemDetail> =
        validation(listOf(FieldErrorDto(e.name, "Invalid value")))

    @ExceptionHandler(MissingServletRequestParameterException::class)
    fun missingParam(e: MissingServletRequestParameterException): ResponseEntity<ProblemDetail> =
        validation(listOf(FieldErrorDto(e.parameterName, "Required")))

    @ExceptionHandler(NoResourceFoundException::class, NoHandlerFoundException::class)
    fun noResource(request: HttpServletRequest): ResponseEntity<ProblemDetail> = if (request.requestURI.startsWith("/api")) {
        problem(ErrorCode.NOT_FOUND, null, emptyMap())
    } else {
        ResponseEntity.notFound().build()
    }

    @ExceptionHandler(EmptyResultDataAccessException::class)
    fun emptyResult(): ResponseEntity<ProblemDetail> = problem(ErrorCode.NOT_FOUND, null, emptyMap())

    private fun validation(errors: List<FieldErrorDto>): ResponseEntity<ProblemDetail> =
        problem(ErrorCode.VALIDATION_FAILED, null, mapOf("fieldErrors" to errors))

    private fun problem(code: ErrorCode, detail: String?, properties: Map<String, Any?>): ResponseEntity<ProblemDetail> {
        val pd = ProblemDetail.forStatusAndDetail(code.status, detail ?: code.title)
        pd.title = code.title
        pd.setProperty("code", code.name)
        properties.forEach { (key, value) -> pd.setProperty(key, value) }
        return ResponseEntity.status(code.status).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(pd)
    }
}
