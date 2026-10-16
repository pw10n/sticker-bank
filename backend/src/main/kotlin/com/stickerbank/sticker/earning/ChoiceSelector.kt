package com.stickerbank.sticker.earning

import java.util.random.RandomGenerator

/** Pure selection of distinct pick choices from the pool (FR-7.7, FR-7.11). */
object ChoiceSelector {
    const val MAX_CHOICES = 3

    /** Sorts the pool by id (deterministic for a seeded generator) and runs a partial Fisher-Yates shuffle. */
    fun select(pool: Collection<Long>, random: RandomGenerator, max: Int = MAX_CHOICES): List<Long> {
        val items = pool.distinct().sorted().toMutableList()
        val k = minOf(max, items.size)
        for (i in 0 until k) {
            val j = i + random.nextInt(items.size - i)
            val tmp = items[i]
            items[i] = items[j]
            items[j] = tmp
        }
        return items.subList(0, k).toList()
    }
}
