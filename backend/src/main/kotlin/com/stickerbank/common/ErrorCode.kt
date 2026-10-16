package com.stickerbank.common

import org.springframework.http.HttpStatus

enum class ErrorCode(val status: HttpStatus, val title: String) {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "Please check the highlighted fields"),
    PARENT_SESSION_REQUIRED(HttpStatus.UNAUTHORIZED, "Parent mode is locked"),
    PIN_INCORRECT(HttpStatus.UNAUTHORIZED, "That PIN is not correct"),
    PIN_LOCKED(HttpStatus.TOO_MANY_REQUESTS, "Too many tries, please wait a moment"),
    PIN_NOT_SET(HttpStatus.CONFLICT, "No parent PIN has been set up yet"),
    PIN_ALREADY_SET(HttpStatus.CONFLICT, "A parent PIN is already set"),
    DAY_CHANGED(HttpStatus.CONFLICT, "A new day has started"),
    FUTURE_DATE(HttpStatus.UNPROCESSABLE_ENTITY, "That day has not happened yet"),
    ROUTINE_NOT_SCHEDULED(HttpStatus.CONFLICT, "This routine is not scheduled for that day"),
    ROUTINE_LOCKED(HttpStatus.CONFLICT, "This routine is finished for today"),
    ALREADY_CLAIMED(HttpStatus.CONFLICT, "This sticker has already been picked"),
    CHOICE_NOT_OFFERED(HttpStatus.UNPROCESSABLE_ENTITY, "That sticker was not one of the choices"),
    PENDING_REQUEST_EXISTS(HttpStatus.CONFLICT, "There is already a prize request waiting"),
    STICKER_NOT_AVAILABLE(HttpStatus.CONFLICT, "That sticker is not available"),
    REQUEST_NOT_PENDING(HttpStatus.CONFLICT, "This prize request is no longer waiting"),
    REQUEST_NOT_COMPLETED(HttpStatus.CONFLICT, "This prize request has not been completed"),
    DESIGN_IN_USE(HttpStatus.CONFLICT, "This sticker design is already in use"),
    STICKER_USED(HttpStatus.CONFLICT, "This sticker was already spent on a prize"),
    REVOKE_CONFIRMATION_REQUIRED(HttpStatus.CONFLICT, "Confirm to remove this sticker"),
    STICKER_REVOKED(HttpStatus.CONFLICT, "This sticker was taken back"),
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not found"),
    CSRF_HEADER_MISSING(HttpStatus.FORBIDDEN, "Missing required request header"),
}

class DomainException(val code: ErrorCode, message: String? = null, val properties: Map<String, Any?> = emptyMap()) :
    RuntimeException(message ?: code.title)

data class FieldErrorDto(val field: String, val message: String)
