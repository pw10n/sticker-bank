package com.stickerbank.common

import jakarta.servlet.http.HttpServletRequest
import org.springframework.core.MethodParameter
import org.springframework.web.bind.support.WebDataBinderFactory
import org.springframework.web.context.request.NativeWebRequest
import org.springframework.web.method.support.HandlerMethodArgumentResolver
import org.springframework.web.method.support.ModelAndViewContainer

/** Controller parameters of type [Actor] resolve to PARENT when a valid parent session exists, else CHILD. */
class ActorArgumentResolver(private val sessions: ParentSessionReader) : HandlerMethodArgumentResolver {
    override fun supportsParameter(parameter: MethodParameter): Boolean = parameter.parameterType == Actor::class.java

    override fun resolveArgument(
        parameter: MethodParameter,
        mavContainer: ModelAndViewContainer?,
        webRequest: NativeWebRequest,
        binderFactory: WebDataBinderFactory?,
    ): Any {
        val request = webRequest.getNativeRequest(HttpServletRequest::class.java)
        return if (request != null && sessions.hasValidSession(request)) Actor.PARENT else Actor.CHILD
    }
}
