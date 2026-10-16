package com.stickerbank.family

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

@RestController
class FamilyController(
    private val bootstrap: BootstrapService,
    private val pins: PinService,
    private val sessions: ParentSessionService,
    private val settings: FamilySettingsService,
) {
    @GetMapping("/api/bootstrap")
    fun bootstrap(): BootstrapDto = bootstrap.bootstrap()

    @PostMapping("/api/parent/pin")
    fun setupPin(@Valid @RequestBody request: PinSetupRequest): ResponseEntity<ParentSessionDto> =
        started(HttpStatus.CREATED, pins.setup(request))

    @PutMapping("/api/parent/pin")
    fun changePin(@Valid @RequestBody request: PinChangeRequest, http: HttpServletRequest): ResponseEntity<Void> {
        pins.change(request.currentPin, request.newPin, http)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/api/parent/session")
    fun unlock(@Valid @RequestBody request: UnlockRequest): ResponseEntity<ParentSessionDto> =
        started(HttpStatus.OK, pins.unlock(request.pin))

    @GetMapping("/api/parent/session")
    fun session(http: HttpServletRequest): ParentSessionDto = sessions.describe(http)

    @PostMapping("/api/parent/session/touch")
    fun touch(http: HttpServletRequest): ParentSessionDto = sessions.touch(http)

    @DeleteMapping("/api/parent/session")
    fun lock(http: HttpServletRequest): ResponseEntity<Void> =
        ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, sessions.end(http).toString()).build()

    @GetMapping("/api/parent/settings")
    fun settings(): SettingsDto = settings.get()

    @PutMapping("/api/parent/settings")
    fun updateSettings(@Valid @RequestBody request: SettingsUpdateRequest): SettingsDto = settings.update(request)

    private fun started(status: HttpStatus, started: StartedSession): ResponseEntity<ParentSessionDto> =
        ResponseEntity.status(status).header(HttpHeaders.SET_COOKIE, started.cookie.toString()).body(started.dto)
}
