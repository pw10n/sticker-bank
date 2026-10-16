package com.stickerbank.common

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/** Requests under /api: Cache-Control no-store, and the CSRF custom-header requirement for state-changing requests. No CORS. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class ApiHeadersFilter : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val path = request.requestURI.substring(request.contextPath.length)
        return !(path == "/api" || path.startsWith("/api/"))
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        response.setHeader("Cache-Control", "no-store")
        if (request.method !in SAFE_METHODS && request.getHeader(HEADER) != "1") {
            val code = ErrorCode.CSRF_HEADER_MISSING
            response.status = code.status.value()
            response.contentType = "application/problem+json"
            response.characterEncoding = "UTF-8"
            response.writer.write(
                """{"type":"about:blank","title":"${code.title}","status":${code.status.value()},""" +
                    """"detail":"Missing required header $HEADER: 1","code":"${code.name}"}""",
            )
            return
        }
        chain.doFilter(request, response)
    }

    companion object {
        const val HEADER = "X-Sticker-Bank"
        private val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS")
    }
}
