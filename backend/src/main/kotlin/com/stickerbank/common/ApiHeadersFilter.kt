package com.stickerbank.common

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Requests under /api: Cache-Control no-store, the minimum frontend version, and the CSRF custom-header requirement for
 * state-changing requests. No CORS.
 *
 * Every response, errors included, carries [MIN_FRONTEND_VERSION_HEADER] so a stale PWA learns it must refresh on its next
 * call, whatever that call was (TDD 9.5). It is omitted for a dev build with nothing configured.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class ApiHeadersFilter internal constructor(private val minFrontendVersion: String?) : OncePerRequestFilter() {
    /** Providers, not beans: a `@WebMvcTest` slice loads this filter without [AppVersion], and then enforces nothing. */
    @Autowired
    constructor(appVersion: ObjectProvider<AppVersion>, properties: ObjectProvider<StickerBankProperties>) :
        this(resolveMinFrontendVersion(properties.ifAvailable?.minFrontendVersion, appVersion.ifAvailable?.value ?: "dev"))

    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val path = request.requestURI.substring(request.contextPath.length)
        return !(path == "/api" || path.startsWith("/api/"))
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        response.setHeader("Cache-Control", "no-store")
        minFrontendVersion?.let { response.setHeader(MIN_FRONTEND_VERSION_HEADER, it) }
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
        const val MIN_FRONTEND_VERSION_HEADER = "X-Min-Frontend-Version"
        private val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS")
        private val VERSION = Regex("""\d+\.\d+\.\d+""")
        private val SERVER_VERSION = Regex("""(\d+\.\d+\.\d+)(?:[-+].*)?""")

        /**
         * The configured minimum, or this server's own version: the image ships the PWA and the API together, so a
         * frontend older than the server it talks to is out of date. Only the numeric `x.y.z` part of the server's
         * version counts (`1.2.0-rc1` means 1.2.0); anything else, like `dev`, enforces nothing. A bad configured value
         * fails startup instead of silently turning enforcement off.
         */
        internal fun resolveMinFrontendVersion(configured: String?, appVersion: String): String? {
            val explicit = configured?.trim().orEmpty()
            if (explicit.isNotEmpty()) {
                require(VERSION.matches(explicit)) { "sticker-bank.min-frontend-version must look like 1.2.3, got '$explicit'" }
                return explicit
            }
            return SERVER_VERSION.matchEntire(appVersion)?.groupValues?.get(1)
        }
    }
}
