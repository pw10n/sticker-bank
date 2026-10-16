package com.stickerbank.common

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class SecurityHeadersFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        response.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; " +
                "object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
        )
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.setHeader("Referrer-Policy", "no-referrer")
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        if (request.isSecure) response.setHeader("Strict-Transport-Security", "max-age=31536000")
        chain.doFilter(request, response)
    }
}
