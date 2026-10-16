package com.stickerbank.common

import jakarta.servlet.http.HttpServletRequest
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Implemented by the family module. */
interface ParentSessionReader {
    fun hasValidSession(request: HttpServletRequest): Boolean
}

object ParentSessionCookie {
    const val NAME = "sb_parent"

    private val random = SecureRandom()

    fun newToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    /** SHA-256 of the token's UTF-8 bytes, stored in `parent_session.token_hash`. */
    fun hash(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8))
}
