package com.stickerbank.sticker.library

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test

class LibrarySupportTest {
    @Test
    fun `escapes like wildcards and backslash`() {
        assertThat(LibrarySupport.escapeLike("50%_off\\")).isEqualTo("50\\%\\_off\\\\")
        assertThat(LibrarySupport.escapeLike("ro")).isEqualTo("ro")
    }

    @Test
    fun `name is trimmed`() {
        assertThat(LibrarySupport.validName("  Rocket ")).isEqualTo("Rocket")
        assertThat(LibrarySupport.validName("a".repeat(40))).hasSize(40)
    }

    @Test
    fun `blank or long names are rejected`() {
        listOf("", "   ", "a".repeat(41)).forEach {
            assertThatThrownBy { LibrarySupport.validName(it) }
                .isInstanceOfSatisfying(DomainException::class.java) { e -> assertThat(e.code).isEqualTo(ErrorCode.VALIDATION_FAILED) }
        }
    }
}
