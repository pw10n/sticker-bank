package com.stickerbank.common

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate

@Component
class ChildLock(private val jdbc: JdbcClient, txManager: PlatformTransactionManager) {
    private val template =
        TransactionTemplate(txManager).apply {
            isolationLevel = TransactionDefinition.ISOLATION_READ_COMMITTED
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRED
        }

    /** Must be called inside an active transaction. */
    fun lock(childId: Long) {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "ChildLock.lock requires an active transaction" }
        val found =
            jdbc.sql("SELECT id FROM child WHERE id = ? FOR UPDATE")
                .param(childId)
                .query(Long::class.java)
                .list()
        if (found.isEmpty()) throw DomainException(ErrorCode.NOT_FOUND, "Child not found")
    }

    fun <T> withChildLock(childId: Long, block: () -> T): T = template.execute {
        lock(childId)
        block()
    }
}
