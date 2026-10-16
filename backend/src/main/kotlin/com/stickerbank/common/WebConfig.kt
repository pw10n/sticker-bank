package com.stickerbank.common

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.core.io.ClassPathResource
import org.springframework.http.CacheControl
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.method.support.HandlerMethodArgumentResolver
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import java.time.Duration

@Configuration(proxyBeanMethods = false)
class WebConfig(private val sessions: ParentSessionReader) : WebMvcConfigurer {
    override fun addArgumentResolvers(resolvers: MutableList<HandlerMethodArgumentResolver>) {
        resolvers.add(ActorArgumentResolver(sessions))
    }

    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        registry.addResourceHandler("/assets/**")
            .addResourceLocations("classpath:/static/assets/")
            .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
        listOf("artwork", "sounds", "icons", "licenses").forEach { dir ->
            registry.addResourceHandler("/$dir/**")
                .addResourceLocations("classpath:/static/$dir/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
        }
        registry.addResourceHandler("/index.html", "/sw.js", "/manifest.webmanifest", "/registerSW.js", "/workbox-*.js")
            .addResourceLocations("classpath:/static/")
            .setCacheControl(CacheControl.noCache())
    }
}

/**
 * SPA fallback: any GET outside /api and /actuator whose last path segment has no '.' is forwarded to /index.html.
 * If static/index.html is not packaged, the request falls through (plain 404).
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 10)
class SpaFallbackFilter : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        if (request.method != "GET") return true
        val path = request.requestURI.substring(request.contextPath.length)
        if (path.startsWith("/api/") || path == "/api" || path.startsWith("/actuator")) return true
        return path.substringAfterLast('/').contains('.')
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        if (!ClassPathResource("static/index.html").exists()) {
            chain.doFilter(request, response)
            return
        }
        request.getRequestDispatcher("/index.html").forward(request, response)
    }
}
