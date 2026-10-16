package com.stickerbank.family

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.ParentSessionReader
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/** Requires a valid parent session under the parent API path, except PIN setup and unlock. Depends only on [ParentSessionReader]. */
class ParentAuthInterceptor(private val sessions: ParentSessionReader) : HandlerInterceptor {
    override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
        if (isOpen(request) || sessions.hasValidSession(request)) return true
        throw DomainException(ErrorCode.PARENT_SESSION_REQUIRED)
    }

    private fun isOpen(request: HttpServletRequest): Boolean {
        if (request.method != "POST") return false
        val path = request.requestURI.substring(request.contextPath.length).trimEnd('/')
        return path == "/api/parent/pin" || path == "/api/parent/session"
    }
}

@Configuration(proxyBeanMethods = false)
class ParentAuthWebConfig(private val sessions: ParentSessionReader) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry.addInterceptor(ParentAuthInterceptor(sessions)).addPathPatterns("/api/parent/**")
    }
}
