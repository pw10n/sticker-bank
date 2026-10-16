package com.stickerbank.child

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test

class ChildNameRulesTest {
    @Test
    fun `trims whitespace`() {
        assertThat(ChildNameRules.normalize("  Jane Doe \n")).isEqualTo("Jane Doe")
    }

    @Test
    fun `blank is rejected`() {
        assertThatThrownBy { ChildNameRules.normalize("   ") }
            .isInstanceOfSatisfying(DomainException::class.java) { assertThat(it.code).isEqualTo(ErrorCode.VALIDATION_FAILED) }
    }

    @Test
    fun `forty characters are fine and forty one are not`() {
        assertThat(ChildNameRules.normalize("a".repeat(40))).hasSize(40)
        assertThatThrownBy { ChildNameRules.normalize("a".repeat(41)) }.isInstanceOf(DomainException::class.java)
    }

    @Test
    fun `length is measured after trimming`() {
        assertThat(ChildNameRules.normalize(" " + "a".repeat(40) + " ")).hasSize(40)
    }

    @Test
    fun `an emoji counts as one character`() {
        val name = "🐱".repeat(40)
        assertThat(ChildNameRules.normalize(name)).isEqualTo(name)
        assertThatThrownBy { ChildNameRules.normalize(name + "🐱") }.isInstanceOf(DomainException::class.java)
    }

    @Test
    fun `error carries the name field`() {
        assertThatThrownBy { ChildNameRules.normalize("") }
            .isInstanceOfSatisfying(DomainException::class.java) {
                assertThat(it.properties["fieldErrors"].toString()).contains("name")
            }
    }
}
