package com.stickerbank.chart

import com.stickerbank.common.DomainException
import com.stickerbank.common.ErrorCode
import com.stickerbank.common.FieldErrorDto
import com.stickerbank.common.StickerStatus
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

/** Pure chart rules (TDD 7.3): state derivation, done counting, date and range validation. */
object ChartRules {
    const val MAX_HISTORY_DAYS = 62L

    fun deriveState(skipped: Boolean, stickerStatus: StickerStatus?, date: LocalDate, today: LocalDate, doneCount: Int): RoutineDayState =
        when {
            skipped -> RoutineDayState.SKIPPED
            stickerStatus == StickerStatus.UNCLAIMED -> RoutineDayState.AWAITING_PICK
            stickerStatus != null -> RoutineDayState.EARNED
            date.isBefore(today) -> RoutineDayState.MISSED
            doneCount > 0 -> RoutineDayState.IN_PROGRESS
            else -> RoutineDayState.NOT_STARTED
        }

    /** Counts only completions of tasks that belong to the day's revision. */
    fun doneCount(plannedTaskIds: Collection<Long>, completedTaskIds: Set<Long>): Int = plannedTaskIds.count { it in completedTaskIds }

    fun parseDate(raw: String, today: LocalDate, field: String = "date"): LocalDate {
        if (raw == "today") return today
        return try {
            LocalDate.parse(raw)
        } catch (_: DateTimeParseException) {
            throw validation(FieldErrorDto(field, "Use the format YYYY-MM-DD"))
        }
    }

    /** Parses a path date and rejects the future (BR-5). */
    fun parsePastOrToday(raw: String, today: LocalDate): LocalDate {
        val date = parseDate(raw, today)
        if (date.isAfter(today)) throw DomainException(ErrorCode.FUTURE_DATE)
        return date
    }

    fun validateRange(fromRaw: String?, toRaw: String?, today: LocalDate): Pair<LocalDate, LocalDate> {
        val errors = mutableListOf<FieldErrorDto>()
        val from = parseOptional("from", fromRaw, today, errors)
        val to = parseOptional("to", toRaw, today, errors)
        if (from != null && to != null) {
            when {
                from.isAfter(to) -> errors += FieldErrorDto("from", "Must not be after the end date")
                to.isAfter(today) -> errors += FieldErrorDto("to", "Must not be in the future")
                ChronoUnit.DAYS.between(from, to) + 1 > MAX_HISTORY_DAYS -> errors += FieldErrorDto("to", "At most $MAX_HISTORY_DAYS days")
            }
        } else if (to != null && to.isAfter(today)) {
            errors += FieldErrorDto("to", "Must not be in the future")
        }
        if (errors.isNotEmpty()) throw validation(*errors.toTypedArray())
        return requireNotNull(from) to requireNotNull(to)
    }

    private fun parseOptional(field: String, raw: String?, today: LocalDate, errors: MutableList<FieldErrorDto>): LocalDate? {
        if (raw.isNullOrBlank()) {
            errors += FieldErrorDto(field, "Required")
            return null
        }
        return try {
            parseDate(raw, today, field)
        } catch (e: DomainException) {
            errors += FieldErrorDto(field, "Use the format YYYY-MM-DD")
            null
        }
    }

    private fun validation(vararg errors: FieldErrorDto) = DomainException(
        ErrorCode.VALIDATION_FAILED,
        properties = mapOf(
            "fieldErrors" to errors.toList(),
        ),
    )
}
