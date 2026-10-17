# Sticker Bank: Technical Design Document (TDD)

| | |
|---|---|
| **Product** | Sticker Bank: a sticker / reward chart for young children |
| **Document** | Technical Design Document |
| **Version** | 0.7 |
| **Status** | Draft |
| **Date** | 2026-10-17 |
| **Implements** | [Functional Design Document v1.3](FDD.md) |

> **Scope note:** This document covers **how** Sticker Bank is built: architecture, data storage, APIs, frontend, security, and deployment. **What** the app does is defined in the FDD. Requirement IDs (FR-x.y, BR-x, A-x, D-x) refer to it. Where the FDD is silent and a technical choice fills the gap, the choice is listed in §16.

### Revision History

| Version | Date | Summary |
|---|---|---|
| 0.1 | 2026-10-15 | First draft from FDD v1.0. Spring Boot 4 (Kotlin), MySQL 8.4, React PWA, one container on Kubernetes, LAN/VPN-only access, online-only writes, Admin PIN reset by SQL. |
| 0.2 | 2026-10-15 | Local development with no database server to run: Testcontainers dev mode for full-stack work, an MSW mock-API mode for UI work (TD-16, §12.5). SQLite and H2 considered and rejected. |
| 0.3 | 2026-10-15 | Sticker revocation from FDD v1.1 (§6.12): `REVOKED` sticker status with a live-only unique key, `sticker_revocation` log, `V4` migration, revoke via a confirmed parent undo (§7.11), new error codes, Parent Mode confirm sheet (TD-17, I-16 to I-20). |
| 0.4 | 2026-10-15 | I'm Done! finish step from FDD v1.2 (FR-6.6 to FR-6.11). `READY_TO_FINISH` is a derived state. Completing the last task no longer earns a sticker: a new `finish` endpoint does (§7.4). A routine still Ready to finish at the end of the day is finished by lazy settlement with a `child.settled_through` watermark (§7.12). `V5` migration (`sticker.finish_mode`, `child.settled_through`, `live_sticker` refresh), `ROUTINE_NOT_READY`, I'm Done! button and parent "Finished automatically" chip, TD-18, TD-19, I-21 to I-25. A routine edit that leaves every task done no longer earns (I-3). |
| 0.5 | 2026-10-15 | Re-earning after a revoke offers the same Sticker Pick choices (FDD v1.3: FR-12.5, FR-12.8, BR-6). `sticker_pick_choice` rows are kept after a claim and after a revoke, and the earn step copies the latest revoked sticker's rows for the same routine and day (§7.5, §7.11). No schema change. A design that was ever offered can't be deleted (I-16). |
| 0.6 | 2026-10-16 | A stale frontend is told to refresh. Every `/api` response carries `X-Min-Frontend-Version` (the configured `STICKER_BANK_MIN_FRONTEND_VERSION`, or the server's own version), and a PWA built older than that applies the new service worker at the first safe moment instead of waiting for a foreground event, with a guarded hard-reload fallback (§8.1, §9.5, TD-20, I-26). `APP_VERSION` is now stamped automatically with the build time, once per build, so every build differs (§12.1). The child and parent pages end with a small `App … · Server …` line (§9.5). No schema or endpoint change. |
| 0.7 | 2026-10-17 | Responsive layout rules from a multi-viewport audit (iPhone 11 Pro, Pixel 10 Pro, iPad Air, desktop). §9.3 now spells out the breakpoints: the two-row child header on phones, the centered auto-fit chart grid, the short-viewport layouts (landscape phones) for the PIN screens and the child picker, the Parent Mode navigation and History grid breakpoints, the pinned Sheet footer, and where safe-area insets are applied. §9.9 adds that theme colors are never used as text color. No schema, endpoint or FDD change. |

---

## 1. Summary

Sticker Bank ships as **one container image**. A Kotlin Spring Boot service serves both the JSON API (`/api/...`) and the React PWA's static files from the same origin, and keeps all data in a MySQL database. It runs as a Deployment on the family's Kubernetes cluster and is reachable over HTTPS only on the home network or over a VPN.

The decisions that shape the rest of the design:

1. **The server owns "today".** The family's time zone is stored in the database, and the server decides which calendar day it is (FR-4.4). Every device sees the same day, and a device with a wrong clock can't complete tomorrow's tasks (BR-5).
2. **Routines are versioned by date.** Editing a routine writes a dated *revision* instead of changing it in place. Any past day can be rebuilt exactly as it was (FR-4.3). The "once today's sticker is earned, changes start tomorrow" rule (BR-2) becomes a single choice of date.
3. **The database protects the currency.** Stickers are currency (BR-12), so earning and spending run in transactions that lock the child's row, backed by unique keys. Two devices tapping at the same moment can't earn twice (BR-7) or spend the same sticker twice (BR-10). A parent's revoke (FDD §6.12) runs under the same lock, so it can't race a claim or a spend.
4. **The PWA is built for toddlers.** Big touch targets, instant (optimistic) taps, celebrations, an installable app shell, and a friendly "waiting for Wi-Fi" state when the server can't be reached.
5. **Earning is an explicit step.** A routine whose tasks are all done is only *Ready to finish*: a state derived from the saved completions, with no stored row. A sticker row is created by the finish call (the child's **I'm Done!**) or, if nobody taps it, by a lazy end-of-day settlement. A mistaken tap is therefore undone with a plain delete (FR-6.7), and both ways of finishing run under the same child lock as every other currency write.

## 2. Technical Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| TD-1 | Backend | Kotlin 2.2+ on Spring Boot 4, Java 25 LTS | Mature ecosystem. Health probes, migrations, validation, and testing come built in. |
| TD-2 | Data access | Spring Data JDBC for simple aggregates. `JdbcClient` for chart/history queries and row locks. No JPA. | The core logic is set-based SQL with explicit locks. JPA's proxies and lazy loading fight Kotlin and hide the SQL. |
| TD-3 | Schema | Flyway migrations, forward-only, expand/contract | Repeatable, and safe during rolling updates. |
| TD-4 | Frontend | React 19 + TypeScript, Vite, vite-plugin-pwa (Workbox), TanStack Query, React Router | Standard, well-supported PWA tooling. |
| TD-5 | Packaging | One image. Spring Boot serves the built PWA. | Same origin: no CORS, one thing to deploy, and the UI and API versions always match. |
| TD-6 | Network | LAN / VPN only, HTTPS required | Child Mode has no login (A-2). Service workers only run over HTTPS. |
| TD-7 | Offline | Writes need the server. The app shell, artwork, and last-loaded data are shown read-only while offline. | No sync conflicts around currency. The server generates Sticker Picks (BR-6). |
| TD-8 | PIN reset | Direct SQL. The Admin runs `CALL reset_parent_pin('<name>')`. | The Admin's MySQL access is the authentication. The procedure makes the audit row impossible to forget (FR-8.10). |
| TD-9 | Day boundary | Family time zone (IANA) stored server-side. The server computes today. | One shared "today" for every device (FR-4.4, BR-5). |
| TD-10 | History | Dated routine revisions, with no nightly jobs | Past days are exact even if the server was down at midnight (FR-4.3, FR-6.5, §6.9). |
| TD-11 | Device sync | Polling every 30 s while visible, plus refetch on focus and reconnect | Simple. No WebSockets, and no pub/sub between replicas. Feels live enough on a LAN. |
| TD-12 | Artwork | A curated subset of Microsoft Fluent Emoji (3D style, MIT license), bundled in the image and referenced by key | Same look on every device and OS, works offline, no uploads (FR-10.3, D-6). |
| TD-13 | Kubernetes | Kustomize base + overlay. Bring your own MySQL via a Secret, with optional in-cluster MySQL manifests. | Plain YAML that works with any GitOps tool. |
| TD-14 | Image | Multi-arch (amd64 + arm64), non-root, read-only root filesystem | Runs on PC or Raspberry Pi nodes, hardened. |
| TD-15 | API contract | OpenAPI generated by springdoc. TypeScript types generated from it. | The frontend and backend can't silently drift apart. |
| TD-16 | Local development | Full stack: `./gradlew bootTestRun` starts a throwaway MySQL 8.4 with Testcontainers. UI only: `npm run dev:mock` answers the API from an in-browser mock (MSW). No SQLite or H2 profile. | Nothing to install or keep running except a container runtime, and dev uses the same database engine and SQL as production. SQLite and H2 were considered and rejected (§12.5). |
| TD-17 | Revoked stickers | Soft delete: the `sticker` row moves to status `REVOKED` and a `sticker_revocation` row records why. Uniqueness of BR-7 moves to a generated column that is `NULL` for revoked rows. | Keeps Prize Request history intact (`prize_request_item` still points at the row), keeps the audit trail for FR-12.9, and still allows exactly one live sticker per routine and day after a re-earn (BR-7). |
| TD-18 | Ready to finish | A derived state, not a stored one: no `sticker` row and no new status. A sticker row is created only by the finish endpoint and by day settlement. | Undoing a mistaken tap stays a plain delete (FR-6.7). A stored "waiting" sticker would need revoke rules, a confirm sheet, and cleanup of its saved choices, which is exactly what the I'm Done! step is meant to avoid. |
| TD-19 | Auto-finish at day end | Lazy settlement per child, tracked by a `child.settled_through` watermark. No scheduler. | Same reasoning as TD-10: it works if the server was down at midnight, needs no job lock when 2 replicas run, and gives the same result whenever it runs. The watermark separates "the day ended with everything done" from "a parent re-checked a past day later" (FR-6.10). |
| TD-20 | Stale frontends | The server announces the oldest frontend build it accepts in an `X-Min-Frontend-Version` header on every `/api` response. A PWA older than that refreshes itself. | The UI and API ship in one image (TD-5), but a PWA that stays open keeps running the build it started with. Waiting for a foreground event (§9.5) let a tablet left on the chart talk to a newer server with old rules, for example finishing a routine the pre-I'm-Done! way and getting no sticker. A header on every response reaches the client on its next call, whatever the call was. |

## 3. Architecture

### 3.1 System Context

```mermaid
flowchart LR
    subgraph Devices["Family devices on home Wi-Fi or VPN"]
        T["Child's tablet<br/>installed PWA"]
        P["Parent's phone<br/>installed PWA"]
    end
    subgraph K8s["Kubernetes, namespace sticker-bank"]
        I["Ingress<br/>TLS, LAN/VPN only"]
        S["Service<br/>port 80 to 8080"]
        APP["Pod: Spring Boot 4 + Kotlin<br/>8080: API and PWA files<br/>8081: health probes"]
    end
    DB[("MySQL 8.4<br/>database sticker_bank")]
    ADMIN["Admin<br/>mysql client"]
    T -->|HTTPS| I
    P -->|HTTPS| I
    I --> S --> APP
    APP -->|JDBC| DB
    ADMIN -->|CALL reset_parent_pin| DB
```

### 3.2 Components

| Component | Responsibility |
|---|---|
| **PWA** (React) | Child Mode and Parent Mode UI, celebrations and sounds, offline shell, day rollover, Parent Mode idle timeout. Holds no authoritative state. |
| **API** (Spring Boot) | All business rules (§7), the PIN and parent sessions, and serving the PWA's files with correct cache headers. Stateless, so any number of replicas can run. |
| **MySQL** | Single source of truth. Holds the stored procedure for the Admin PIN reset. |
| **Kubernetes** | Ingress with TLS (LAN/VPN only), Deployment, Service, ConfigMap, Secret, NetworkPolicy. |

### 3.3 Request Routing Inside the App

| Path | Served by | `Cache-Control` |
|---|---|---|
| `/api/**` | REST controllers | `no-store` |
| `/assets/**` (hashed JS, CSS, fonts) | Static files | `public, max-age=31536000, immutable` |
| `/artwork/**`, `/sounds/**` | Static files | `public, max-age=86400` (the service worker precache keeps them current) |
| `/index.html`, `/sw.js`, `/manifest.webmanifest` | Static files | `no-cache` |
| Any other `GET` without a file extension | `index.html` (SPA fallback) | `no-cache` |
| `:8081/actuator/**` | Actuator, not routed by the Service | n/a |

## 4. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| **Backend** | | |
| Language / runtime | Kotlin 2.2+, Java 25 LTS (Eclipse Temurin) | |
| Framework | Spring Boot 4.0.x: `spring-boot-starter-webmvc`, `-data-jdbc`, `-validation`, `-actuator`, `-flyway` + `flyway-mysql` | Spring MVC (blocking). JDBC blocks anyway, and the load is tiny. Boot 4 split auto-configuration into modules, so Flyway needs its own starter. |
| Database driver | MySQL Connector/J | URL params: `connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true` |
| JSON | Jackson with the Kotlin module, ISO-8601 dates | |
| PIN hashing | `spring-security-crypto` BCrypt (cost 12) | The crypto module only, with no Spring Security filter chain (§11.3). |
| API docs | springdoc-openapi (the Boot 4 line) | Spec served at `/api/openapi.json` |
| Build | Gradle 9, Kotlin DSL, version catalog, ktlint + detekt | |
| Tests | JUnit Jupiter, MockK, Testcontainers (MySQL), AssertJ | |
| **Frontend** | | |
| Language | TypeScript (strict) | |
| UI and routing | React 19, React Router 7 | |
| Build | Vite, vite-plugin-pwa (Workbox) | |
| Server state | TanStack Query 5, with child-mode queries persisted to IndexedDB | Read-only display while offline (§9.6) |
| API client | openapi-typescript + openapi-fetch | Types generated from the backend spec |
| Styling | Tailwind CSS 4, with design tokens per child theme color | |
| Motion | Motion (formerly Framer Motion), canvas-confetti | Celebrations and the "sticking" animation |
| Drag and drop | dnd-kit (touch and keyboard sensors) | FR-2.4, FR-3.4 |
| Forms | React Hook Form + Zod | Parent screens |
| Font | Andika (SIL Open Font License), self-hosted | Designed for beginning readers |
| Tests | Vitest, React Testing Library, MSW, Playwright | |
| **Data and platform** | | |
| Database | MySQL 8.4 LTS, InnoDB, `utf8mb4` | Names and prize text can contain emoji |
| Container | Multi-stage Dockerfile, runtime `eclipse-temurin:25-jre` | |
| Orchestration | Kubernetes, Kustomize | |
| Build-only tooling | Node 24 LTS | Not in the runtime image |
| Local development | A container runtime: OrbStack, Colima, or Docker Desktop | Runs the dev database through Testcontainers (§12.5) and builds the image locally |

> Exact versions are pinned in `gradle/libs.versions.toml` and `package-lock.json` at project start. The major versions above are the baseline.

## 5. Repository Layout

```
sticker-bank/
├── docs/                    FDD.md, TDD.md, runbooks/
├── artwork/                 catalog.json, source images, conversion script
├── backend/                 Spring Boot service (Gradle, Kotlin DSL)
│   ├── src/main/
│   │   ├── kotlin/com/stickerbank/
│   │   │   ├── common/      errors (ProblemDetail), FamilyClock, ChildLock, web and header config
│   │   │   ├── family/      settings, PIN, parent sessions, ParentAuthInterceptor
│   │   │   ├── child/       child profiles
│   │   │   ├── routine/     routines, revisions, tasks, schedules, skips, copy
│   │   │   ├── chart/       Daily Chart assembly, task completion, finish, day settlement, history
│   │   │   ├── sticker/     library, categories, artwork catalog, earning, Sticker Pick, Sticker Book
│   │   │   └── prize/       Prize Requests
│   │   └── resources/
│   │       ├── application.yaml
│   │       └── db/migration/  V1__schema.sql … V5__routine_finish.sql
│   └── src/test/kotlin/com/stickerbank/
│       ├── dev/             TestStickerBankApplication, MySqlContainerConfig, DemoDataSeeder (§12.5)
│       └── …                unit and integration tests
├── frontend/                Vite + React + TypeScript
│   ├── public/artwork/      generated 256 px WebP files (committed)
│   └── src/
│       ├── api/             openapi.json snapshot, generated types, client, query hooks
│       ├── app/             providers: mode, device settings, idle timer, day rollover, update prompt, offline state
│       ├── child/           Daily Chart, task tiles, celebration, Sticker Pick, Sticker Book, Get a Prize, PIN pad
│       ├── mocks/           MSW handlers, in-memory fake API, named scenarios (dev:mock and tests)
│       ├── parent/          children, routine editor, library, prize requests, history, settings
│       ├── ui/              shared components (BigTile, Sheet, ConfirmDialog, Artwork)
│       └── sound/
├── deploy/k8s/              base/, overlays/home/, optional/mysql/
├── Dockerfile
└── compose.yaml             app image + MySQL 8.4 for end-to-end tests
```

Backend packages are organized by feature. Each one has a controller, a service (transaction boundary and rules), repositories, and DTOs.

## 6. Data Model

### 6.1 Naming

| FDD term | Code / table |
|---|---|
| Child | `child` |
| Routine | `routine` (identity, display order) + `routine_revision` (dated definition) |
| Task | `task` (identity) + `revision_task` (label, icon, and position within one revision) |
| Sticker (a design in the Sticker Library) | `sticker_design` |
| Sticker in a Sticker Book | `sticker` |
| Sticker Pick | The `sticker_pick_choice` rows of a sticker. They are shown while it is `UNCLAIMED` and kept afterwards, so a re-earn after a revoke can offer them again (FR-12.5). |
| Ready to finish | Not stored. The derived state `READY_TO_FINISH` (§7.3). |
| I'm Done! (finish) | `POST …/routines/{id}/finish` (§7.4). The sticker records how it was finished in `sticker.finish_mode` (`TAPPED` or `AUTO`). |
| Category / pack | `sticker_category` |
| Prize Request | `prize_request` + `prize_request_item` |
| Parent PIN and family settings | `family_settings` (a single row) |

### 6.2 Conventions

- **One deployment = one family (A-1).** There is no tenant column. Family-wide settings live in a single row.
- IDs are `BIGINT AUTO_INCREMENT`. Timestamps are `DATETIME(3)` in UTC: the JVM and the JDBC session are both forced to UTC. Calendar days are `DATE` values in the family time zone (`chart_date`).
- Character set `utf8mb4`, collation `utf8mb4_0900_ai_ci`.
- Artwork is referenced by `*_key` strings, validated against the bundled catalog (§9.7).
- Rows a child owns cascade when the child is deleted (FR-1.3, BR-14). Sticker designs are protected by `RESTRICT` (BR-15).
- Weekdays are stored as a 7-bit mask: bit 0 = Monday … bit 6 = Sunday.

### 6.3 Entity Relationships

```mermaid
erDiagram
    child ||--o{ routine : has
    routine ||--|{ routine_revision : "defined by"
    routine ||--o{ task : owns
    routine_revision ||--o{ revision_task : lists
    task ||--o{ revision_task : "appears in"
    task ||--o{ task_completion : "done on a date"
    routine ||--o{ routine_skip : "skipped on"
    child ||--o{ sticker : earns
    routine |o--o{ sticker : "earned by"
    sticker_design |o--o{ sticker : "looks like"
    sticker ||--o{ sticker_pick_choice : "offers (rows kept after claim and revoke)"
    sticker_design ||--o{ sticker_pick_choice : "offered as"
    sticker_category |o--o{ sticker_design : groups
    child ||--o{ prize_request : makes
    prize_request ||--|{ prize_request_item : contains
    sticker ||--o{ prize_request_item : "spent in"
    sticker ||--o| sticker_revocation : "revoked by"
```

`family_settings`, `parent_session`, and `pin_reset_log` stand alone.

### 6.4 Routine Revisions (FR-4.3, BR-2, BR-3)

A routine's definition is stored as **revisions**: name, icon, color, schedule, paused, deleted, and its ordered task list. Each revision has an `effective_from` date. **The definition for day D is the revision with the latest `effective_from ≤ D`.**

**Which date an edit applies from:**

```
E = today + 1   if the routine has already earned its sticker today
                (a live sticker row exists for routine × today, claimed or not;
                 REVOKED rows don't count)
E = today       otherwise
```

An edit upserts the revision with `effective_from = E`, so repeated edits on the same day overwrite a single row. Every kind of edit follows this rule: renaming, rescheduling (FR-4.1), pausing (FR-2.6), changing tasks (FR-3.x), and deleting (FR-2.3, stored as a revision with `deleted = true`).

What follows from this:

- Past days never change, because their revisions are never touched (FR-4.3).
- A routine that earned its sticker stays exactly as it was for the rest of the day (BR-2, FR-7.4). If a parent then revokes the sticker (§7.11), today's revision is still the one in force. Edits saved while the sticker existed stay dated tomorrow, and new edits apply to today again.
- Tasks keep their identity (`task.id`) across revisions, so a completion survives a rename. A removed task's completion stays in the table but no longer counts. If the task is put back the same day, it counts again.
- If an edit to today's revision leaves every remaining task done, the routine becomes Ready to finish. It earns nothing until I'm Done! is tapped or the day ends (FR-6.6, BR-18, see I-3).
- A routine appears on day D only if its revision for D exists, isn't deleted or paused, includes D's weekday, and has at least one task (FR-3.5). A skip row for D shows it as Skipped (FR-4.5).
- Display order (`routine.position`) isn't versioned. Past days are shown in the current order (I-6).

The query for one child's plan on date D:

```sql
WITH ranked AS (
  SELECT rr.*,
         ROW_NUMBER() OVER (PARTITION BY rr.routine_id ORDER BY rr.effective_from DESC) AS rn
  FROM routine_revision rr
  JOIN routine r ON r.id = rr.routine_id
  WHERE r.child_id = :childId
    AND rr.effective_from <= :date
)
SELECT * FROM ranked
WHERE rn = 1
  AND NOT deleted
  AND NOT paused
  AND (days_mask & (1 << :weekdayIndex)) <> 0;
```

One more query then loads the `revision_task` rows for the returned revisions. History over a date range loads all of the child's revisions once and evaluates each day in memory.

### 6.5 Sticker Status in Data

| `sticker.status` | Meaning | `design_id` | `prize_request_id` |
|---|---|---|---|
| `UNCLAIMED` | Earned, but the Sticker Pick isn't done yet. The choices are in `sticker_pick_choice`. Not counted in the Sticker Book. | `NULL` | `NULL` |
| `AVAILABLE` | In the Sticker Book and can be spent | set | `NULL` |
| `PENDING` | Part of the child's open Prize Request | set | the pending request |
| `USED` | Spent on a prize | set | the completed request |
| `REVOKED` | Un-earned by a parent (FDD §6.12). Not shown or counted anywhere a child or the Sticker Book looks. Details are in `sticker_revocation`. Its `sticker_pick_choice` rows stay, so a re-earn can offer the same set (FR-12.5). | set if it was claimed, else `NULL` | `NULL` |

The transitions follow FDD §5.3, with `UNCLAIMED` added as the step before it. `UNCLAIMED`, `AVAILABLE`, and `PENDING` can move to `REVOKED`; `USED` can't (FR-12.7). `REVOKED` is final: re-earning inserts a **new** row (FR-12.5). The `sticker_pick_choice` rows stay with the sticker in every status, but only an `UNCLAIMED` sticker shows them (`GET …/pick` returns no choices otherwise). A `REVOKED` sticker keeps its rows so the re-earn can offer the same set (§7.5).

**Ready to finish has no row.** Until a parent or the child taps I'm Done!, or the day ends, a routine with every task done has no `sticker` row at all (TD-18). Unchecking a task is therefore an ordinary delete of a `task_completion` row, with nothing to revoke or clean up (FR-6.7, BR-19). The row is created by Finish (§7.4) or by day settlement (§7.12), and both go through the earn routine in §7.5.

**Live stickers.** Every read that means "earned stickers" (Daily Chart, Sticker Book and counts, the unclaimed tray, `RevisionPolicy`, skip checks, bootstrap counts) goes through the view `live_sticker` (`SELECT * FROM sticker WHERE status <> 'REVOKED'`). Only history, revocation, and Prize Request history read the `sticker` table directly. An integration test checks each of those reads with a revoked row present. `prize_request_item` permanently records which stickers were in each request, so cancelled and reversed requests still show their stickers in history (FR-11.10).

**Fallback sticker (FR-7.11):** Flyway seeds one `sticker_design` with `is_fallback = TRUE` ("Gold Star"). It's never offered in a pick, can't be edited or deleted, and is hidden from the library page (I-13). When the pick pool is empty, the earned sticker is created directly as `AVAILABLE` with this design.

### 6.6 Schema (`V1__schema.sql`)

```sql
CREATE TABLE family_settings (
  id                      TINYINT      NOT NULL PRIMARY KEY,
  pin_hash                VARCHAR(100) NULL,             -- NULL = no PIN yet, or reset by Admin
  pin_set_at              DATETIME(3)  NULL,
  failed_pin_attempts     INT          NOT NULL DEFAULT 0,
  lockout_level           INT          NOT NULL DEFAULT 0,
  pin_locked_until        DATETIME(3)  NULL,
  time_zone               VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  parent_idle_timeout_sec INT          NOT NULL DEFAULT 300,
  updated_at              DATETIME(3)  NOT NULL,
  CONSTRAINT ck_family_settings_singleton CHECK (id = 1)
);
INSERT INTO family_settings (id, updated_at) VALUES (1, UTC_TIMESTAMP(3));

CREATE TABLE parent_session (
  id           BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token_hash   BINARY(32)  NOT NULL,                     -- SHA-256 of the cookie value
  created_at   DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  CONSTRAINT uq_parent_session_token UNIQUE (token_hash)
);

CREATE TABLE pin_reset_log (                             -- FR-8.10
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reset_at   DATETIME(3)  NOT NULL,
  admin_name VARCHAR(100) NOT NULL,
  db_user    VARCHAR(288) NOT NULL                       -- MySQL login that ran the reset
);

CREATE TABLE child (
  id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(40) NOT NULL,
  avatar_key  VARCHAR(64) NOT NULL,
  theme_color VARCHAR(16) NOT NULL,
  position    INT         NOT NULL,
  archived_at DATETIME(3) NULL,                          -- FR-1.4 (Could), unused in v1
  created_at  DATETIME(3) NOT NULL,
  updated_at  DATETIME(3) NOT NULL
);

CREATE TABLE routine (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  child_id   BIGINT      NOT NULL,
  position   INT         NOT NULL,                       -- FR-2.4, not versioned
  created_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,                           -- hides it from the parent's list
  CONSTRAINT fk_routine_child FOREIGN KEY (child_id) REFERENCES child (id) ON DELETE CASCADE,
  INDEX ix_routine_child (child_id, position)
);

CREATE TABLE routine_revision (
  id             BIGINT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  routine_id     BIGINT           NOT NULL,
  effective_from DATE             NOT NULL,
  name           VARCHAR(60)      NOT NULL,
  icon_key       VARCHAR(64)      NOT NULL,
  color          VARCHAR(16)      NULL,
  days_mask      TINYINT UNSIGNED NOT NULL,              -- bit 0 = Monday … bit 6 = Sunday
  paused         BOOLEAN          NOT NULL DEFAULT FALSE,
  deleted        BOOLEAN          NOT NULL DEFAULT FALSE,
  updated_at     DATETIME(3)      NOT NULL,
  CONSTRAINT fk_revision_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE,
  CONSTRAINT uq_revision_effective UNIQUE (routine_id, effective_from)
);

CREATE TABLE task (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  routine_id BIGINT      NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_task_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE
);

CREATE TABLE revision_task (
  revision_id BIGINT           NOT NULL,
  task_id     BIGINT           NOT NULL,
  position    INT              NOT NULL,
  label       VARCHAR(60)      NOT NULL,
  icon_key    VARCHAR(64)      NOT NULL,
  days_mask   TINYINT UNSIGNED NULL,                     -- FR-3.6 (Could); NULL = every scheduled day
  PRIMARY KEY (revision_id, task_id),
  CONSTRAINT fk_rt_revision FOREIGN KEY (revision_id) REFERENCES routine_revision (id) ON DELETE CASCADE,
  CONSTRAINT fk_rt_task     FOREIGN KEY (task_id)     REFERENCES task (id)             ON DELETE CASCADE
);

CREATE TABLE routine_skip (                              -- FR-4.5
  routine_id BIGINT      NOT NULL,
  chart_date DATE        NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (routine_id, chart_date),
  CONSTRAINT fk_skip_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE
);

CREATE TABLE task_completion (                           -- BR-1
  task_id      BIGINT                 NOT NULL,
  chart_date   DATE                   NOT NULL,
  routine_id   BIGINT                 NOT NULL,          -- denormalized for chart queries
  child_id     BIGINT                 NOT NULL,          -- denormalized for history queries
  completed_at DATETIME(3)            NOT NULL,
  completed_by ENUM('CHILD','PARENT') NOT NULL,
  PRIMARY KEY (task_id, chart_date),
  INDEX ix_completion_routine_day (routine_id, chart_date),
  INDEX ix_completion_child_day (child_id, chart_date),
  CONSTRAINT fk_completion_task    FOREIGN KEY (task_id)    REFERENCES task (id)    ON DELETE CASCADE,
  CONSTRAINT fk_completion_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE,
  CONSTRAINT fk_completion_child   FOREIGN KEY (child_id)   REFERENCES child (id)   ON DELETE CASCADE
);

CREATE TABLE sticker_category (                          -- FR-10.9
  id       BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(40) NOT NULL,
  enabled  BOOLEAN     NOT NULL DEFAULT TRUE,            -- turns a whole pack on or off
  position INT         NOT NULL,
  CONSTRAINT uq_category_name UNIQUE (name)
);

CREATE TABLE sticker_design (
  id          BIGINT                   NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(40)              NOT NULL,
  artwork_key VARCHAR(64)              NOT NULL,
  category_id BIGINT                   NULL,
  status      ENUM('ACTIVE','RETIRED') NOT NULL DEFAULT 'ACTIVE',
  is_fallback BOOLEAN                  NOT NULL DEFAULT FALSE,   -- FR-7.11
  created_at  DATETIME(3)              NOT NULL,
  updated_at  DATETIME(3)              NOT NULL,
  CONSTRAINT fk_design_category FOREIGN KEY (category_id) REFERENCES sticker_category (id) ON DELETE SET NULL,
  INDEX ix_design_pool (status, is_fallback, category_id)
);

CREATE TABLE prize_request (
  id           BIGINT                                             NOT NULL AUTO_INCREMENT PRIMARY KEY,
  child_id     BIGINT                                             NOT NULL,
  status       ENUM('PENDING','COMPLETED','CANCELLED','REVERSED') NOT NULL,
  created_by   ENUM('CHILD','PARENT')                             NOT NULL,
  prize_text   VARCHAR(200)                                       NULL,   -- required to complete
  note         VARCHAR(500)                                       NULL,
  created_at   DATETIME(3)                                        NOT NULL,
  completed_at DATETIME(3)                                        NULL,
  cancelled_at DATETIME(3)                                        NULL,
  cancelled_by ENUM('CHILD','PARENT')                             NULL,
  reversed_at  DATETIME(3)                                        NULL,
  updated_at   DATETIME(3)                                        NOT NULL,
  CONSTRAINT fk_request_child FOREIGN KEY (child_id) REFERENCES child (id) ON DELETE CASCADE,
  INDEX ix_request_child_status (child_id, status, created_at),
  INDEX ix_request_status (status, created_at)
);

CREATE TABLE sticker (                                   -- one earned sticker in a Sticker Book
  id               BIGINT                                         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  child_id         BIGINT                                         NOT NULL,
  source           ENUM('ROUTINE','BONUS')                        NOT NULL,
  routine_id       BIGINT                                         NULL,   -- NULL for bonus stickers (FR-7.12)
  chart_date       DATE                                           NOT NULL,
  routine_name     VARCHAR(60)                                    NULL,   -- snapshot at earn time (I-9)
  routine_icon_key VARCHAR(64)                                    NULL,
  design_id        BIGINT                                         NULL,   -- NULL while UNCLAIMED
  status           ENUM('UNCLAIMED','AVAILABLE','PENDING','USED') NOT NULL,
  prize_request_id BIGINT                                         NULL,   -- set while PENDING or USED
  earned_at        DATETIME(3)                                    NOT NULL,
  claimed_at       DATETIME(3)                                    NULL,
  CONSTRAINT uq_sticker_routine_day UNIQUE (routine_id, chart_date),                 -- BR-7, FR-7.3
  CONSTRAINT fk_sticker_child   FOREIGN KEY (child_id)   REFERENCES child (id)   ON DELETE CASCADE,
  -- Routines are only hard-deleted together with their child, so this cascade never
  -- removes stickers from a child who still exists (BR-3).
  CONSTRAINT fk_sticker_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE,
  CONSTRAINT fk_sticker_design  FOREIGN KEY (design_id)  REFERENCES sticker_design (id) ON DELETE RESTRICT, -- BR-15
  CONSTRAINT fk_sticker_request FOREIGN KEY (prize_request_id) REFERENCES prize_request (id) ON DELETE SET NULL,
  INDEX ix_sticker_book (child_id, status, chart_date)
);

CREATE TABLE sticker_pick_choice (                       -- BR-6: saved once, kept after the pick or a revoke, reused on a re-earn
  sticker_id BIGINT  NOT NULL,
  slot       TINYINT NOT NULL,                           -- 1–3, display order
  design_id  BIGINT  NOT NULL,
  PRIMARY KEY (sticker_id, slot),
  CONSTRAINT uq_choice_design  UNIQUE (sticker_id, design_id),                       -- 3 different stickers (FR-7.7)
  CONSTRAINT fk_choice_sticker FOREIGN KEY (sticker_id) REFERENCES sticker (id)        ON DELETE CASCADE,
  CONSTRAINT fk_choice_design  FOREIGN KEY (design_id)  REFERENCES sticker_design (id) ON DELETE RESTRICT  -- I-4
);

CREATE TABLE prize_request_item (
  prize_request_id BIGINT NOT NULL,
  sticker_id       BIGINT NOT NULL,
  PRIMARY KEY (prize_request_id, sticker_id),
  CONSTRAINT fk_item_request FOREIGN KEY (prize_request_id) REFERENCES prize_request (id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sticker FOREIGN KEY (sticker_id)       REFERENCES sticker (id)       ON DELETE CASCADE
);
```

Deleting a child relies on these cascades. An integration test proves the delete removes every row the child owns (§13).

### 6.7 Revocation Schema (`V4__sticker_revocation.sql`)

V1 to V3 are already in place and migrations are forward-only (TD-3), so revocation is a new migration. Every step is additive or a metadata-only change, so it's safe during a rolling update.

```sql
-- 1) New status. Appending to the end of an ENUM is an instant change in MySQL 8.
ALTER TABLE sticker
  MODIFY status ENUM('UNCLAIMED','AVAILABLE','PENDING','USED','REVOKED') NOT NULL;

-- 2) BR-7 only applies to live stickers. is_live is 1 for live rows and NULL for
--    revoked ones. NULLs never collide in a UNIQUE index, so any number of REVOKED
--    rows can share (routine, date) with one live row. It's generated from status,
--    not routine_id: MySQL forbids a stored generated column whose base column has
--    a CASCADE foreign key, which routine_id does.
ALTER TABLE sticker
  ADD COLUMN is_live TINYINT AS (IF(status = 'REVOKED', NULL, 1)) STORED,
  ADD CONSTRAINT uq_sticker_live_routine_day UNIQUE (routine_id, chart_date, is_live);  -- also indexes fk_sticker_routine
ALTER TABLE sticker DROP INDEX uq_sticker_routine_day;

CREATE VIEW live_sticker AS
  SELECT * FROM sticker WHERE status <> 'REVOKED';

-- 3) Why a Pending request was cancelled (FR-12.6).
ALTER TABLE prize_request
  ADD COLUMN cancel_reason ENUM('CANCELLED','ALL_STICKERS_REVOKED') NULL AFTER cancelled_by;
UPDATE prize_request SET cancel_reason = 'CANCELLED' WHERE status = 'CANCELLED';

-- 4) One row per revoke (FR-12.3, FR-12.9, FR-12.11).
CREATE TABLE sticker_revocation (
  sticker_id        BIGINT                                NOT NULL PRIMARY KEY,
  child_id          BIGINT                                NOT NULL,          -- denormalized for history queries
  chart_date        DATE                                  NOT NULL,          -- the day that was un-earned
  task_id           BIGINT                                NULL,              -- the task that was unchecked
  task_label        VARCHAR(60)                           NOT NULL,          -- snapshot, survives task edits
  from_status       ENUM('UNCLAIMED','AVAILABLE','PENDING') NOT NULL,
  prize_request_id  BIGINT                                NULL,              -- set if it was PENDING
  request_cancelled BOOLEAN                               NOT NULL DEFAULT FALSE,
  note              VARCHAR(200)                          NULL,              -- FR-12.11 (Could)
  revoked_at        DATETIME(3)                           NOT NULL,
  CONSTRAINT fk_revocation_sticker FOREIGN KEY (sticker_id)       REFERENCES sticker (id)       ON DELETE CASCADE,
  CONSTRAINT fk_revocation_child   FOREIGN KEY (child_id)         REFERENCES child (id)         ON DELETE CASCADE,
  CONSTRAINT fk_revocation_task    FOREIGN KEY (task_id)          REFERENCES task (id)          ON DELETE SET NULL,
  CONSTRAINT fk_revocation_request FOREIGN KEY (prize_request_id) REFERENCES prize_request (id) ON DELETE SET NULL,
  INDEX ix_revocation_child_day (child_id, chart_date)
);
```

`V1__schema.sql` stays unchanged. The §6.6 listing shows V1 as shipped. The `uq_sticker_routine_day` key it shows is replaced by `uq_sticker_live_routine_day` here.

### 6.8 Finish Schema (`V5__routine_finish.sql`)

Two additive, nullable columns and a refreshed view, so it is safe during a rolling update (TD-3). While the update is rolling, a pod still on the old version keeps earning on the last task. That is harmless, because the unique key keeps it to one live sticker per routine and day either way.

```sql
-- 1) How the sticker was finished (FR-6.11). NULL for stickers earned before this
--    migration, which the last task earned, and for bonus stickers.
ALTER TABLE sticker
  ADD COLUMN finish_mode ENUM('TAPPED','AUTO') NULL;

-- 2) The last day whose end-of-day auto-finish has been applied (§7.12).
--    NULL = never settled, which means nothing before today is waiting.
ALTER TABLE child
  ADD COLUMN settled_through DATE NULL;

-- 3) MySQL expands SELECT * when a view is created, so live_sticker (V4) doesn't see
--    the new column until the view is redefined.
CREATE OR REPLACE VIEW live_sticker AS
  SELECT * FROM sticker WHERE status <> 'REVOKED';
```

`V1__schema.sql` stays unchanged. The `sticker` and `child` listings in §6.6 don't show these two columns.

## 7. Core Flows and Business Logic

### 7.1 Concurrency Model

- **Per-child lock.** Every write that touches a child's chart, stickers, or Prize Requests runs in one transaction that locks the child row first: `SELECT id FROM child WHERE id = ? FOR UPDATE` (via `ChildLock.withChildLock(childId) { … }`). One child's writes run one at a time, and different children never block each other. A family makes a handful of writes a minute, so contention is effectively zero.
- **Isolation.** The connection pool uses `READ COMMITTED`, so reads made after the lock is taken see everything committed before it.
- **Unique keys as a backstop:** `sticker (routine_id, chart_date, is_live)` for BR-7 (live stickers only, §6.7), `task_completion (task_id, chart_date)` for BR-1, and `sticker_pick_choice (sticker_id, design_id)` for FR-7.7.
- **PIN operations** lock the `family_settings` row instead. No transaction takes both locks, so lock ordering can't deadlock.
- **BR-10 and BR-11** (a sticker in only one open request, and one pending request per child) are checked under the child lock.
- **Revoke** (§7.11) takes the same child lock, so it is serialized against completing tasks, claiming a pick, and every Prize Request action for that child.
- **Finish and day settlement** (§7.4, §7.12) take the same child lock, so two I'm Done! taps, or a tap racing the first request after midnight, produce exactly one sticker.

### 7.2 Today and Day Rollover (FR-4.4, BR-4, BR-5)

- `FamilyClock` combines an injected `java.time.Clock` (UTC) with `family_settings.time_zone`. `today()` is `LocalDate.now(clock.withZone(zone))`. `nextDayStartsAt()` is the start of tomorrow in that zone, as an instant, which handles DST.
- The time zone is captured from the device when the PIN is first set up (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and can be changed in Parent → Settings. Changing it affects which day is "today" from then on. Stored dates don't move.
- `GET /api/bootstrap` returns `today`, `nextDayStartsAt`, and `serverTime`. The PWA works out its clock offset and refetches at the rollover moment, and also on `visibilitychange` and `focus`.
- Every task write, and every finish, names the date the device is showing. A Child Mode write for a date that's no longer today gets `409 DAY_CHANGED`, and the PWA loads the new day instead of ticking the wrong one. A routine the child left Ready to finish isn't lost: the first request of the new day settles yesterday (§7.12), and its sticker waits in the "Stickers to pick" tray.

### 7.3 Building the Daily Chart (§6.5)

For child *c* and date *D ≤ today*: build the plan (§6.4), then for each routine look up its skip, the completions for that revision's tasks, and the sticker for (routine, D). The first matching row below wins.

| State | Condition |
|---|---|
| `SKIPPED` | A skip row exists for (routine, D). Hidden in Child Mode (I-5). |
| `EARNED` | A live sticker exists and has been claimed. |
| `AWAITING_PICK` | A live sticker exists and is `UNCLAIMED`. |
| `READY_TO_FINISH` | No live sticker and every task in D's revision is done. Derived, never stored (TD-18). On a past day this only happens after a parent checked the last task there (§7.12). |
| `IN_PROGRESS` | Some tasks are done. |
| `NOT_STARTED` | No tasks are done and D is today. |
| `MISSED` | No live sticker, not every task done, and D is before today. This includes a past day whose sticker was revoked (FR-9.1). |

```mermaid
stateDiagram-v2
    [*] --> NotStarted
    NotStarted --> InProgress: first task done
    InProgress --> NotStarted: last done task undone
    InProgress --> ReadyToFinish: every task done
    ReadyToFinish --> InProgress: a task is undone
    ReadyToFinish --> AwaitingPick: I'm Done! tapped
    ReadyToFinish --> AwaitingPick: day ends, auto-finish
    AwaitingPick --> Earned: child picks a sticker
    NotStarted --> Skipped: parent skips the day
    InProgress --> Skipped: parent skips the day
    ReadyToFinish --> Skipped: parent skips the day
    Skipped --> NotStarted: parent un-skips
    NotStarted --> Missed: day ends
    InProgress --> Missed: day ends
    Missed --> ReadyToFinish: parent checks the last task of a past day
    ReadyToFinish --> Missed: parent unchecks a task of a past day
    AwaitingPick --> InProgress: parent revokes (today)
    Earned --> InProgress: parent revokes (today)
    AwaitingPick --> Missed: parent revokes (past day)
    Earned --> Missed: parent revokes (past day)
```

Revoking a single-task routine today leaves no tasks done, so it goes to `NOT_STARTED` instead of `IN_PROGRESS`.

The chart response also lists unclaimed stickers from earlier days, which the child sees in a "Stickers to pick" tray (I-2). That tray is also where a sticker waits after an automatic finish (§7.12). With a parent session, each routine's `sticker` object also carries `status`, `prizeRequestId`, `revocable`, and `autoFinished`, which the review sheet needs (FR-12.1, FR-6.11, §7.11).

### 7.4 Completing, Undoing, and Finishing (§6.6, FR-6.6–6.9, FR-7.1–7.4)

**Mark done:** `PUT /api/children/{c}/days/{D}/tasks/{t}` (idempotent)

1. Resolve the actor: `PARENT` if the request carries a valid parent session, otherwise `CHILD`.
2. Check D. If D is after today → `422 FUTURE_DATE` (BR-5). If D is before today and the actor is `CHILD` → `409 DAY_CHANGED` (BR-4).
3. Lock child *c*, then settle any ended days (§7.12).
4. Load the revision for D. Check that the routine is scheduled and not skipped on D, and that task *t* is in that revision.
5. If the routine already has a live sticker for D, return its state unchanged: it's locked (FR-7.4).
6. `INSERT … ON DUPLICATE KEY UPDATE task_id = task_id` into `task_completion`. (Not `INSERT IGNORE`, which also hides foreign-key errors.)
7. Commit, and return the routine's state. When every task in the revision is now done, that state is `READY_TO_FINISH`. **Nothing is earned here** (FR-7.1, BR-18), so the response has no `pick`.

**Undo:** `DELETE` on the same path. If the routine has no live sticker for D, delete the completion row. That includes a routine that is Ready to finish: unchecking is an ordinary undo, with no confirmation and no revoke (FR-6.7, BR-19). A parent can also undo tasks on past days that haven't earned a sticker (FR-6.5). If the routine has a live sticker for D:

- `CHILD` actor → `409 ROUTINE_LOCKED`, always (FR-7.4, BR-16).
- `PARENT` actor without `?revokeSticker=true` → `409 REVOKE_CONFIRMATION_REQUIRED`, with the sticker in the body. Nothing changes.
- `PARENT` actor with `?revokeSticker=true` → revoke (§7.11).

**Finish (I'm Done!):** `POST /api/children/{c}/days/{D}/routines/{r}/finish` (idempotent)

1. Resolve the actor and check D exactly as for a task write: D after today → `422 FUTURE_DATE`, and a `CHILD` write for a past day → `409 DAY_CHANGED`.
2. Lock child *c*, then settle any ended days (§7.12).
3. Load the revision for D. The routine must be scheduled and not skipped on D (`409 ROUTINE_NOT_SCHEDULED`).
4. If a live sticker already exists for (routine, D), return it unchanged. While it is still `UNCLAIMED` the response carries the saved choices, so a double tap, or a second device, gets the same three (BR-6).
5. If any task in the revision isn't done → `409 ROUTINE_NOT_READY`, and nothing changes. This happens when another device unchecked a task a moment earlier. The PWA reloads the chart.
6. **Earn** the sticker (§7.5) with `finish_mode = TAPPED`.
7. Commit. Return the routine's new state (`AWAITING_PICK`, or `EARNED` if the pool was empty and the fallback was awarded) and the `pick`.

A parent session may finish a routine on any day up to today (FR-6.5). Without one, only today.

### 7.5 Earning and the Sticker Pick (FR-7.7–7.11, FR-12.5, BR-6, BR-8)

**Earn** (one routine with two callers, Finish in §7.4 and day settlement in §7.12, always inside the child lock):

1. Insert a `sticker` row: `UNCLAIMED`, with a snapshot of the routine's name and icon, `chart_date = D`, `finish_mode` (`TAPPED` or `AUTO`), and `earned_at` (now for `TAPPED`, the end of day D for `AUTO`, §7.12). The unique key makes a duplicate impossible (BR-7).
2. Look for the latest `REVOKED` sticker for the same routine and `chart_date` that still has `sticker_pick_choice` rows. If there is one, copy its designs to the new sticker in the same slots and skip to the end (FR-12.5). Design status and category aren't checked again, so a design retired in between is still offered, as it would be in an unclaimed pick (BR-8).
3. Otherwise, build the pool: designs that are `ACTIVE`, not the fallback, and whose category is `NULL` or enabled (FR-10.9).
4. If the pool is empty, assign the fallback design, set the sticker to `AVAILABLE` and `claimed_at = now`, and mark the response `pick.autoAwarded = true` (FR-7.11).
5. Otherwise, choose `min(3, pool size)` different designs uniformly at random (an injected `Random`, seeded in tests) and save them as `sticker_pick_choice` slots 1–3.

**Claim:** `POST /api/stickers/{s}/pick {designId}`

1. Lock the sticker's child.
2. If the sticker is `REVOKED` → `409 STICKER_REVOKED` (a parent revoked it while the pick was open on another device). If it's already claimed: return `200` if it's the same design (an idempotent double tap), or `409 ALREADY_CLAIMED` if it's a different one.
3. `designId` must be one of the saved choices, otherwise `422 CHOICE_NOT_OFFERED`. The design's status isn't checked, so a design retired after the pick was made can still be picked (BR-8).
4. Set `design_id`, `AVAILABLE`, and `claimed_at`. The choices stay in `sticker_pick_choice`, unused (`GET …/pick` only returns them for an `UNCLAIMED` sticker), so a revoke followed by a re-earn can offer the same set again (FR-12.5). The other two aren't added to the Sticker Book (FR-7.8).

`GET /api/stickers/{s}/pick` returns the saved choices, so a reload never changes them (FR-7.10, BR-6). Choices point at the live design rows, so an edited name or image always shows its latest version (BR-8, FR-10.4).

```mermaid
sequenceDiagram
    autonumber
    actor Child
    participant PWA
    participant API as Spring Boot API
    participant DB as MySQL
    Child->>PWA: Tap the last task
    PWA->>PWA: Show the check right away
    PWA->>API: PUT /api/children/7/days/2026-10-15/tasks/213
    API->>DB: Lock child 7 (SELECT ... FOR UPDATE)
    API->>DB: Insert task_completion
    API-->>PWA: 200 with routine READY_TO_FINISH, no pick
    PWA->>Child: Small pop, then the I'm Done! button
    Child->>PWA: Tap I'm Done!
    PWA->>API: POST /api/children/7/days/2026-10-15/routines/31/finish
    API->>DB: Lock child 7
    API->>DB: Every task done, so insert UNCLAIMED sticker and 3 choices
    API-->>PWA: 200 with routine AWAITING_PICK and pick with 3 choices
    PWA->>Child: Confetti and fanfare
    PWA->>Child: Sticker Pick with 3 stickers
    Child->>PWA: Tap one sticker
    PWA->>API: POST /api/stickers/955/pick with designId
    API->>DB: Lock child, set design and AVAILABLE (choices stay)
    API-->>PWA: 200 with the sticker
    PWA->>Child: Sticking animation into the Sticker Book
```

### 7.6 Prize Requests (§6.11, BR-10–BR-14)

All of these run under the child lock.

| Action | Who | Rules | Effect |
|---|---|---|---|
| Create | Child (FR-11.3) or parent (FR-11.12) | The child has no `PENDING` request (`409 PENDING_REQUEST_EXISTS`, BR-11). At least 1 sticker. Every sticker belongs to this child (BR-13) and is `AVAILABLE` (`409 STICKER_NOT_AVAILABLE`, BR-10). | Request is `PENDING`. Items are inserted. Stickers become `PENDING` and point at the request. |
| Cancel | Child, for their own pending request (FR-11.6), or parent (FR-11.9) | The request is `PENDING`. | Stickers go back to `AVAILABLE` with `prize_request_id = NULL`. Request becomes `CANCELLED`, with `cancelled_by` and `cancel_reason = CANCELLED` recorded. |
| Complete | Parent (FR-11.8) | The request is `PENDING`. `prizeText` is required (1–200 chars); `note` is optional (≤ 500). | The request's `PENDING` stickers become `USED`. Revoked ones are left out (§7.11). Request becomes `COMPLETED`, with `completed_at`. |
| Edit prize or note | Parent (FR-11.13) | The request is `COMPLETED`. | Text is updated. |
| Reverse (Could) | Parent (FR-11.14) | The request is `COMPLETED`. | Stickers go back to `AVAILABLE`. Request becomes `REVERSED` and stays in history. The parent can then revoke one of them (FR-12.7). |

A request's sticker count and list mean its **non-revoked** items. `prize_request_item` rows are never deleted, so history can still show a revoked sticker struck through with "revoked".

### 7.7 Routine Management (§6.2–6.4)

- **Create** (FR-2.1, FR-4.2): inserts the routine, its tasks, and a revision effective today. All seven days are selected by default. The routine is added at the end of the order.
- **Save** (FR-2.2, FR-2.6, FR-3.1–3.4, FR-4.1): the editor sends the whole definition in one `PUT`: name, icon, color, days, paused, and the ordered task list. Tasks that include an `id` keep their identity, tasks without one are created, and tasks left out are dropped from the new revision. The response includes `effectiveFrom`, so the editor can say *"Today's sticker is already earned. Your changes start tomorrow."* Saving never earns a sticker. If the edit leaves every remaining task done, the routine just becomes Ready to finish (I-3).
- **Delete** (FR-2.3): writes a revision with `deleted = true` from date E, and sets `routine.deleted_at` so the routine leaves the parent's list right away. Stickers keep their routine snapshot (BR-3).
- **Reorder** (FR-2.4): `PUT …/routines/order` with the full list of IDs, rewritten in one transaction.
- **Copy** (FR-2.5): creates a new routine with new task IDs and a revision effective today, for the target child.
- **Skip** (FR-4.5): a `routine_skip` row for any date on which the routine has no live sticker (I-15). After a revoke, that day can be skipped.

### 7.8 Parent Mode, PIN, and Sessions (§6.8)

**First run, and after an Admin reset** (FR-8.5, FR-8.9): `family_settings.pin_hash` is `NULL`, so `bootstrap.setupRequired` is `true`. With no children set up, the PWA opens the welcome screen. With children, Child Mode works as usual and the Parent Mode button leads to creating a new PIN. The parent enters the PIN twice, and it's sent along with the device's time zone. The server saves it with a conditional `UPDATE … WHERE pin_hash IS NULL`, so if two devices race, the first one wins. Success opens a parent session.

**Unlock** (FR-8.3, FR-8.7):

1. Lock `family_settings`.
2. If `pin_locked_until` is in the future → `429 PIN_LOCKED` with `retryAfterSeconds`.
3. Check the PIN with BCrypt. On failure, increment `failed_pin_attempts`. On the 5th failure, set `pin_locked_until` and reset the counter. Repeated lockouts get longer: 1 min, 5 min, 15 min, then 60 min (I-7). The response is `401 PIN_INCORRECT` with the number of attempts left.
4. On success, reset the counters and create a session.

The lockout is shared by all devices. Devices have no identity, and a per-device counter could be reset just by clearing storage.

**Sessions** (FR-8.4):

- A 256-bit random token, sent in the cookie `sb_parent` with `HttpOnly; Secure; SameSite=Strict; Path=/api`. Only the token's SHA-256 is stored (`parent_session`).
- A session is valid while `now < last_seen_at + idle timeout` and `now < expires_at`. The idle timeout defaults to 5 minutes and can be changed in Parent → Settings (I-8). The absolute limit is 12 hours. `last_seen_at` is updated at most every 30 seconds.
- In Parent Mode, the PWA watches for taps and key presses, and sends `POST /api/parent/session/touch` at most once a minute while the parent is active. When the parent goes idle, the PWA calls `DELETE /api/parent/session` and returns to Child Mode. The Exit button does the same.
- Everything under `/api/parent/**` requires a valid session (`ParentAuthInterceptor`). The shared endpoints (task completion, creating and cancelling Prize Requests) only use the session to decide who the actor is.

**Change PIN** (FR-8.6): requires a session and the current PIN (wrong guesses count toward the lockout). Saves the new hash and deletes all other sessions.

**Admin reset** (FR-8.8–8.10, TD-8). `V3__reset_pin_procedure.sql` creates:

```sql
CREATE PROCEDURE reset_parent_pin(IN p_admin_name VARCHAR(100))
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  IF p_admin_name IS NULL OR TRIM(p_admin_name) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'reset_parent_pin: admin name is required';
  END IF;
  START TRANSACTION;
    UPDATE family_settings
       SET pin_hash = NULL, pin_set_at = NULL,
           failed_pin_attempts = 0, lockout_level = 0, pin_locked_until = NULL,
           updated_at = UTC_TIMESTAMP(3)
     WHERE id = 1;
    DELETE FROM parent_session;
    INSERT INTO pin_reset_log (reset_at, admin_name, db_user)
    VALUES (UTC_TIMESTAMP(3), TRIM(p_admin_name), SESSION_USER());
  COMMIT;
END
```

`SESSION_USER()` records the MySQL login that ran the call. (`CURRENT_USER()` would record the procedure's definer instead.) The app reads PIN state from the database on every PIN request, so a reset takes effect immediately, without a restart. Children, routines, stickers, and history aren't touched. The step-by-step procedure is in §12.6.

### 7.9 History (§6.9)

`GET /api/parent/children/{c}/history?from&to` covers up to 62 days, ending no later than today. It returns, for each day and routine, the state from §7.3, the done/total counts, and `autoFinished` (FR-6.11). A `READY_TO_FINISH` routine on a past day shows as incomplete in the calendar (FR-9.1), with a hint that every task is done. Opening a day uses the normal chart endpoint with the parent session (FR-9.2), and that's also where tasks on past days can be fixed (FR-6.5). When a fix checks the last task of a past routine, it becomes Ready to finish and the day detail shows its I'm Done! button. Once the parent taps it, the parent can open the Sticker Pick right away and hand the device to the child, or leave the sticker in the child's "Stickers to pick" tray (I-2). The day detail is also where a parent reviews and revokes stickers (§7.11). The history response includes a `revocations` list for the range (FR-12.9): date/time, routine name, day, task label, the design if one was picked, whether a Prize Request was cancelled, and the note.

### 7.10 Sticker Library (§6.10)

- **Starter set:** Flyway `V2` seeds 24 designs across Animals, Space, Food, and Vehicles (FR-10.2). Because seeding is a migration, it runs once. Deleting starter stickers doesn't bring them back.
- **Add and edit** (FR-10.3, FR-10.4): a name (1–40 chars) and an artwork key from the catalog. Edits change the row every Sticker Book entry points to, so they show up everywhere.
- **Retire and reactivate** (FR-10.5): changes `status`.
- **Delete** (FR-10.6, BR-15): only allowed when no `sticker` and no `sticker_pick_choice` row, open or kept, uses the design (I-4, I-16). The foreign keys are `RESTRICT`, and the API answers `409 DESIGN_IN_USE` with "Retire it instead".
- **Warning** (FR-10.7): the list response includes `activeCount`, and the page warns when it's below 3.
- **Search and packs** (FR-10.8, FR-10.9): search by name, filter by status or category. Disabling a category removes its designs from the pick pool without changing their own status.

### 7.11 Revoking a Sticker (FDD §6.12, BR-16, BR-17)

**Review** (FR-12.1): the parent opens a day in Parent Mode (`/parent/history/:childId`, which includes today). The chart response shows each routine's tasks and, for an earned routine, its sticker: `status`, the design if picked, `prizeRequestId`, and `autoFinished` (FR-6.11). `revocable` is `false` only for `USED`.

**Revoke:** `DELETE /api/children/{c}/days/{D}/tasks/{t}?revokeSticker=true`, with a parent session and an optional body `{ "note": "…" }` (FR-12.11, ≤ 200 chars).

1. Check the session. Without one, the actor is `CHILD` → `409 ROUTINE_LOCKED` (BR-16). D after today → `422 FUTURE_DATE`. Past dates are allowed for the parent.
2. Lock child *c*, then settle any ended days (§7.12).
3. Load the revision for D. Task *t* must be in it, and its completion row must exist. Otherwise return the current state unchanged (idempotent: a double tap on the confirm button is harmless).
4. Load the live sticker for (routine, D). If there is none, this is an ordinary undo (§7.4).
5. If the sticker is `USED` → `409 STICKER_USED` (FR-12.7). Nothing changes.
6. In the same transaction:
   1. Delete the `task_completion` row for (t, D). Other completions stay (FR-12.4).
   2. Leave its `sticker_pick_choice` rows in place, whatever the status, so the re-earn can offer them again (FR-12.5, FR-12.8). An `UNCLAIMED` sticker stops being offered because it is no longer live, not because its rows are gone.
   3. If `PENDING` in request *r*: set the sticker's `prize_request_id = NULL`. If *r* now has no `PENDING` stickers, set *r* to `CANCELLED` with `cancelled_by = PARENT`, `cancel_reason = ALL_STICKERS_REVOKED`, and `cancelled_at` (FR-12.6).
   4. Set the sticker to `REVOKED`. That sets `is_live` to `NULL`, so the routine and day can earn again (BR-7, FR-12.5).
   5. Insert `sticker_revocation` with the task label snapshot, `from_status`, *r*, and whether *r* was cancelled.
7. Commit. Return the routine's new state (`IN_PROGRESS`, `NOT_STARTED`, or `MISSED`), plus `revoked: { stickerId, fromStatus, prizeRequestId, requestCancelled }`.

**Earning again** (FR-12.5) goes through the normal earn step. When the last task is done again, the routine is Ready to finish. Once it is finished again (the child's or a parent's I'm Done! through §7.4, or the end of the day if it is still today, §7.12), §7.5 inserts a new `UNCLAIMED` sticker and, in its step 2, copies the revoked sticker's saved choices onto it. The child sees the same set, in the same order, whether or not they had picked one before. A routine that has been revoked more than once keeps getting the same set. Only when no revoked sticker has saved choices (for example, the first sticker was the automatic fallback, FR-7.11) is a new draw made.

```mermaid
sequenceDiagram
    autonumber
    actor Parent
    participant PWA
    participant API as Spring Boot API
    participant DB as MySQL
    Parent->>PWA: Tap a done task in an earned routine (Parent Mode)
    PWA->>Parent: Confirm sheet: the sticker that will be removed, the task, Pending warning
    Parent->>PWA: Confirm
    PWA->>API: DELETE /api/children/7/days/2026-10-15/tasks/210?revokeSticker=true
    API->>DB: Lock child 7
    API->>DB: Delete completion, sticker to REVOKED, update request if Pending, insert revocation
    API-->>PWA: 200 with routine IN_PROGRESS and revoked
    PWA->>Parent: Task unchecked, routine shows 3 of 4
    Note over PWA: Child devices pick up the change on the next poll (≤ 30 s)
```

**Other devices.** Child devices learn about a revoke through the usual polling (TD-11). If a revoke lands while the child has that sticker's pick open, the claim returns `409 STICKER_REVOKED`, and the PWA closes the pick quietly and reloads the chart (FR-12.10). If the child is on Get a Prize with the request open, the next poll shows the smaller request, or the empty state if it was cancelled.

### 7.12 Ending the Day: Auto-finish (FR-6.10, FR-6.11, TD-19)

A routine that is still Ready to finish when its day ends is finished for the child. Nothing runs at midnight. The server settles ended days **lazily**, the first time anything touches that child afterwards, so a server that was down at midnight gives the same result (TD-10).

**Watermark.** `child.settled_through` is the last day whose ending has been applied. Days up to and including it are never auto-finished again.

**`settle(childId)`** is called before every chart read, history read, task write, and finish for that child:

1. `yesterday = today − 1` (§7.2). Read `settled_through` without a lock. If it is `yesterday` or later, return. This is the only cost on almost every request.
2. Lock child *c* (writes already hold the lock) and read `settled_through` again. If another request settled while this one waited, return.
3. If `settled_through` is `NULL`, set it to `yesterday` and return. A child with no watermark has nothing waiting: a new child has no ended days, and before `V5` the last task earned the sticker at once, so no fully done routine was left waiting.
4. Otherwise load the plan (§6.4), the completions, and the live stickers for the days after `settled_through` up to `yesterday`, in three queries, like History (§7.9). For each day and each routine that is **not skipped**, has **every task done**, and has **no live sticker**, run the earn routine (§7.5) with `finish_mode = AUTO`. Its `earned_at` is the start of the next day in the family time zone, so DST and the moment the settlement ran don't matter. The sticker is `UNCLAIMED`, or `AVAILABLE` with the fallback design when there are no choices to offer (FR-7.11). There is no celebration: the child finds it in the "Stickers to pick" tray (I-2).
5. Set `settled_through = yesterday` in the same transaction.

**What this does and doesn't cover**

- **A parent's later edit of an ended day.** The watermark has already passed it, so checking the last task of a past day leaves the routine Ready to finish until a parent taps I'm Done! (FR-6.10, I-24). The same goes for re-checking a task after revoking a past day's sticker.
- **Skipped routines** are left alone (FR-4.5, I-23).
- **Revoking an auto-finished sticker** is an ordinary revoke (§7.11). If the day is today, the routine can be finished again by the child, or by the next end of day.
- **A `GET` that writes.** The first chart or history read after midnight can insert stickers. The result is idempotent, and it happens at most once per child per day.
- **Time zone changes.** If a change moves "yesterday" earlier than `settled_through`, nothing happens. If it moves it later, the extra days settle on the next request.
- **Logging.** Each automatic finish is logged at INFO like any earned sticker, with `finishMode=AUTO`.
- **Not a scheduled job.** A midnight job would miss days when the server was down, would need a job lock when 2 replicas run (§12.2), and would add time-zone and DST edge cases. The lazy version has none of these.

## 8. API

### 8.1 Conventions

- JSON over HTTPS, under `/api`, with camelCase fields. Calendar days are `YYYY-MM-DD` in the family's time zone. Instants are ISO-8601 UTC.
- Errors use RFC 9457 `application/problem+json` (Spring's built-in `ProblemDetail`) with a stable `code` field. The PWA reacts to `code`, never to message text.
- Every write must send the header `X-Sticker-Bank: 1` (CSRF defense, §11.2).
- Every response under `/api`, errors included, carries `X-Min-Frontend-Version: x.y.z`, the oldest frontend build the server accepts (TD-20, §9.5). It is the configured `STICKER_BANK_MIN_FRONTEND_VERSION`, or the server's own `APP_VERSION` when that is unset, and it is left out for a `dev` build.
- Access levels: **Open** means anyone who can reach the app (Child Mode). **Parent** requires a valid parent session. **Open/Parent** is open, but a parent session changes what's allowed.
- OpenAPI is served at `/api/openapi.json`. A backend test writes the spec to `frontend/src/api/openapi.json`, and CI fails if the committed copy is out of date.

### 8.2 Endpoints

**Child Mode**

| Method | Path | Access | Purpose | FDD |
|---|---|---|---|---|
| GET | `/api/bootstrap` | Open | `setupRequired`, `today`, `nextDayStartsAt`, `serverTime`, `timeZone`, children, `pendingPrizeRequestCount`, `parentIdleTimeoutSeconds`, `appVersion` | FR-1.6, FR-8.5, FR-11.11 |
| GET | `/api/children/{childId}/days/{date or today}` | Open | Daily Chart (past days are read-only) | §6.5, FR-9.2 |
| PUT | `/api/children/{childId}/days/{date}/tasks/{taskId}` | Open/Parent | Mark a task done (past dates need Parent). Never earns a sticker: the routine becomes `READY_TO_FINISH` when the last task is done. | FR-6.1, FR-6.5, FR-6.6 |
| DELETE | `/api/children/{childId}/days/{date}/tasks/{taskId}[?revokeSticker=true]` | Open/Parent | Undo. On a routine without a sticker, including `READY_TO_FINISH`, it is a plain undo. With a parent session and `revokeSticker=true`, it also revokes the routine's sticker (§7.11). | FR-6.2, FR-6.7, FR-12.2–12.8 |
| POST | `/api/children/{childId}/days/{date}/routines/{routineId}/finish` | Open/Parent | I'm Done!: finish a routine whose tasks are all done and earn its sticker (idempotent, §7.4) | FR-6.5, FR-6.8, FR-7.1 |
| GET | `/api/stickers/{stickerId}/pick` | Open | The saved choices | FR-7.10, BR-6 |
| POST | `/api/stickers/{stickerId}/pick` | Open | Claim `{designId}` | FR-7.8 |
| GET | `/api/children/{childId}/stickers?status=&cursor=` | Open | A Sticker Book page, plus counts | FR-7.5, FR-7.6, FR-11.15–11.18 |
| GET | `/api/stickers/{stickerId}` | Open | One sticker, with the prize and date if it's Used | FR-11.17 |
| GET | `/api/children/{childId}/prize-requests/pending` | Open | The pending request, or `null` | FR-11.6, BR-11 |
| POST | `/api/children/{childId}/prize-requests` | Open/Parent | Create `{stickerIds}` | FR-11.3, FR-11.12 |
| POST | `/api/prize-requests/{id}/cancel` | Open/Parent | Cancel a pending request | FR-11.6, FR-11.9 |

**Parent session and settings**

| Method | Path | Access | Purpose | FDD |
|---|---|---|---|---|
| POST | `/api/parent/pin` | Open, only while no PIN is set | Create the PIN `{pin, timeZone}`, which opens a session | FR-8.5, FR-8.9 |
| PUT | `/api/parent/pin` | Parent | Change the PIN `{currentPin, newPin}` | FR-8.6 |
| POST | `/api/parent/session` | Open | Unlock `{pin}` | FR-8.3, FR-8.7 |
| GET | `/api/parent/session` | Parent | Check that the session is still valid | |
| POST | `/api/parent/session/touch` | Parent | Keep the session alive | FR-8.4 |
| DELETE | `/api/parent/session` | Parent | Exit Parent Mode | FR-8.4 |
| GET, PUT | `/api/parent/settings` | Parent | Time zone, idle timeout, and the last PIN reset (read-only) | FR-4.4, FR-8.4, FR-8.10 |

**Children, routines, history**

| Method | Path | Access | Purpose | FDD |
|---|---|---|---|---|
| GET, POST | `/api/parent/children` | Parent | List, create | FR-1.1, FR-1.2 |
| PUT, DELETE | `/api/parent/children/{childId}` | Parent | Edit, delete (cascades) | FR-1.3 |
| GET, POST | `/api/parent/children/{childId}/routines` | Parent | List current definitions, create | FR-2.1 |
| PUT | `/api/parent/children/{childId}/routines/order` | Parent | Reorder | FR-2.4 |
| GET, PUT, DELETE | `/api/parent/routines/{routineId}` | Parent | Read, save the whole definition, delete | FR-2.2, FR-2.3, FR-2.6, §6.3, FR-4.1–4.3 |
| POST | `/api/parent/routines/{routineId}/copy` | Parent | Copy to `{targetChildId}` | FR-2.5 |
| PUT, DELETE | `/api/parent/routines/{routineId}/skips/{date}` | Parent | Skip or un-skip one day | FR-4.5 |
| GET | `/api/parent/children/{childId}/history?from=&to=` | Parent | Calendar data (with `autoFinished` per routine), plus `revocations` for the range | FR-9.1, FR-6.11, FR-12.9 |

**Sticker Library and Prize Requests**

| Method | Path | Access | Purpose | FDD |
|---|---|---|---|---|
| GET, POST | `/api/parent/library/designs` | Parent | List (`q`, `status`, `categoryId`, with `activeCount`), add | FR-10.1, FR-10.3, FR-10.7, FR-10.8 |
| PUT, DELETE | `/api/parent/library/designs/{id}` | Parent | Edit, delete | FR-10.4, FR-10.6 |
| PUT | `/api/parent/library/designs/{id}/status` | Parent | `ACTIVE` or `RETIRED` | FR-10.5 |
| GET, POST, PUT, DELETE | `/api/parent/library/categories[/{id}]` | Parent | Packs, turned on or off | FR-10.9 |
| GET | `/api/parent/prize-requests?status=&childId=&cursor=` | Parent | Pending list, history | FR-11.7, FR-11.10 |
| POST | `/api/parent/prize-requests/{id}/complete` | Parent | `{prizeText, note}` | FR-11.8 |
| PUT | `/api/parent/prize-requests/{id}` | Parent | Edit the prize text or note | FR-11.13 |
| POST | `/api/parent/prize-requests/{id}/reverse` | Parent | Reverse (Could) | FR-11.14 |

### 8.3 Examples

**Daily Chart**

```json
GET /api/children/7/days/today

{
  "childId": 7,
  "date": "2026-10-15",
  "isToday": true,
  "routines": [
    {
      "routineId": 31,
      "name": "Morning School Routine",
      "iconKey": "sun",
      "color": "#FFB703",
      "state": "IN_PROGRESS",
      "doneCount": 2,
      "taskCount": 4,
      "tasks": [
        { "taskId": 210, "label": "Brush teeth",   "iconKey": "toothbrush", "done": true  },
        { "taskId": 211, "label": "Get dressed",   "iconKey": "t-shirt",    "done": true  },
        { "taskId": 212, "label": "Eat breakfast", "iconKey": "bowl",       "done": false },
        { "taskId": 213, "label": "Shoes on",      "iconKey": "sneaker",    "done": false }
      ],
      "sticker": null
    }
  ],
  "unclaimedFromEarlierDays": [
    { "stickerId": 902, "chartDate": "2026-10-14", "routineName": "Bedtime" }
  ]
}
```

**Completing the last task**

```json
PUT /api/children/7/days/2026-10-15/tasks/213

200 OK
{
  "routine": { "routineId": 31, "state": "READY_TO_FINISH", "doneCount": 4, "taskCount": 4 }
}
```

**Tapping I'm Done!**

```json
POST /api/children/7/days/2026-10-15/routines/31/finish

200 OK
{
  "routine": { "routineId": 31, "state": "AWAITING_PICK", "doneCount": 4, "taskCount": 4 },
  "pick": {
    "stickerId": 955,
    "autoAwarded": false,
    "choices": [
      { "designId": 4,  "name": "Happy Whale", "artworkKey": "whale"  },
      { "designId": 12, "name": "Rocket",      "artworkKey": "rocket" },
      { "designId": 19, "name": "Taco",        "artworkKey": "taco"   }
    ]
  }
}
```

**Revoking a sticker**

```json
DELETE /api/children/7/days/2026-10-15/tasks/210?revokeSticker=true
{ "note": "Teeth not actually brushed" }

200 OK
{
  "routine": { "routineId": 31, "state": "IN_PROGRESS", "doneCount": 3, "taskCount": 4 },
  "revoked": { "stickerId": 955, "fromStatus": "PENDING", "prizeRequestId": 88, "requestCancelled": false }
}
```

**Error**

```json
409 Conflict
Content-Type: application/problem+json

{ "type": "about:blank", "status": 409, "title": "This routine is finished for today", "code": "ROUTINE_LOCKED" }
```

### 8.4 Error Codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Invalid request body. Includes field errors. |
| `PARENT_SESSION_REQUIRED` | 401 | A Parent endpoint was called without a valid session. |
| `PIN_INCORRECT` | 401 | Wrong PIN. Includes `attemptsRemaining`. |
| `PIN_LOCKED` | 429 | In the cooldown. Includes `retryAfterSeconds`. |
| `PIN_NOT_SET` / `PIN_ALREADY_SET` | 409 | Unlock before setup, or setup after a PIN exists. |
| `DAY_CHANGED` | 409 | A Child Mode write (task or finish) for a day that's no longer today. Includes `today`. |
| `FUTURE_DATE` | 422 | A write for a date after today. |
| `ROUTINE_NOT_SCHEDULED` | 409 | The routine isn't on the chart for that date. |
| `ROUTINE_NOT_READY` | 409 | Finish (I'm Done!) on a routine that still has tasks to do, for example because another device just unchecked one. |
| `ROUTINE_LOCKED` | 409 | Undo after the sticker was earned, in Child Mode (BR-16). |
| `REVOKE_CONFIRMATION_REQUIRED` | 409 | A parent undo on an earned routine without `revokeSticker=true`. Includes the sticker, so the PWA can show the confirm sheet. |
| `STICKER_USED` | 409 | Revoke of a `USED` sticker (FR-12.7). |
| `STICKER_REVOKED` | 409 | Claiming a pick whose sticker was revoked. |
| `ALREADY_CLAIMED` | 409 | The pick was already claimed with a different design. |
| `CHOICE_NOT_OFFERED` | 422 | The design isn't one of the saved choices. |
| `PENDING_REQUEST_EXISTS` | 409 | BR-11 |
| `STICKER_NOT_AVAILABLE` | 409 | BR-10, BR-13 |
| `REQUEST_NOT_PENDING` / `REQUEST_NOT_COMPLETED` | 409 | Wrong state for this action. |
| `DESIGN_IN_USE` | 409 | BR-15 / I-4. Retire the design instead. |
| `NOT_FOUND` | 404 | Unknown ID. |

## 9. Frontend (PWA)

### 9.1 Screens and Routes

| Route | Screen | Mode |
|---|---|---|
| `/` | Goes to this device's last-selected child, or shows the child picker | Child |
| `/c/:childId` | Daily Chart | Child |
| `/c/:childId/pick/:stickerId` | Sticker Pick. It's a route, so a reload reopens the same pick. | Child |
| `/c/:childId/book` | Sticker Book | Child |
| `/c/:childId/prize` | Get a Prize | Child |
| `/welcome` | First run: create the PIN | n/a |
| `/parent` | Parent home: pending Prize Requests and shortcuts | Parent |
| `/parent/children`, `/parent/children/:id` | Child profiles | Parent |
| `/parent/children/:id/routines`, `/parent/routines/:id` | Routine list, routine editor | Parent |
| `/parent/history/:childId` | Calendar, and day detail (including today) with past-day fixes, sticker review, and revoke | Parent |
| `/parent/library` | Sticker Library | Parent |
| `/parent/prizes` | Prize Requests and their history | Parent |
| `/parent/settings` | PIN, time zone, idle timeout, sounds, install help, licenses | Parent |

The `/parent/*` routes sit behind a guard that calls `GET /api/parent/session` and shows the PIN pad if the session isn't valid. The guard is only for the user experience. The server enforces access on every request (§11).

### 9.2 State

- **Server state** lives in TanStack Query, with keys such as `['bootstrap']`, `['chart', childId, date]`, `['book', childId, status]`, `['pick', stickerId]`, and `['pendingRequest', childId]`.
- **Refreshing:** refetch on focus and on reconnect. `bootstrap` and today's chart poll every 30 s while visible, which picks up the pending-request badge and changes from other devices. The parent's Prize Requests page polls every 15 s while open.
- **Device-only preferences** live in `localStorage`, with every access wrapped in try/catch: the last-selected child and sounds on/off. These are per device on purpose, so each child's tablet can open to that child.
- **App state** lives in React context: the current mode (child or parent), online status, and whether a service worker update is waiting.

### 9.3 Child Mode Interaction (§6.5, §6.6, A-4, A-5)

- **Touch targets** are at least 72 × 72 CSS px, with at least 16 px between them: well above the usual 44 px guideline, for toddler fingers. Task icons are at least 56 px, and labels are 22–24 px in Andika. Text always comes with an icon (A-5).
- **Done looks different in three ways:** a check badge, a color fill, and a little pop of the icon. Color is never the only cue.
- **Taps are optimistic.** The check appears immediately while the request goes out, and rolls back on error. A task ignores taps while its request is in flight, and ignores a second tap within 600 ms, so a toddler's double tap doesn't immediately undo the task.
- **I'm Done!** (FR-6.6–6.8): when the server says a routine is `READY_TO_FINISH`, a full-width button appears in its own row below the task tiles, at least 72 px tall (text plus an icon), with a gap of at least 24 px above it. The row is added below the tiles, so nothing under the finger moves. The button is driven by the server state, not the optimistic check, and it ignores taps for 600 ms after it appears, so the tap that checked the last task can't also press it. While the routine is Ready to finish its tiles stay tappable: unchecking one removes the button. Closing or reloading the app keeps the state, because it is derived from the saved completions (FR-6.9). On `409 ROUTINE_NOT_READY` or `409 DAY_CHANGED` the chart just reloads.
- **The last task gets only the small pop** (FR-6.4). The big celebration waits for the finish response, because the server returns the choices (typically under 100 ms on a LAN).
- **Focus** (FR-5.6): finished routines (`AWAITING_PICK`, `EARNED`) collapse, and the first unfinished routine is highlighted and scrolled into view. A routine that is Ready to finish counts as unfinished, so it stays open with its button visible. No time-of-day settings are needed.
- **No accidental gestures:** `touch-action: manipulation` (no double-tap zoom), `overscroll-behavior: none` (no pull-to-refresh), no text selection or long-press menus in Child Mode, and nothing that depends on hover.
- **Layout:** on a phone, routine cards stack. On a tablet in landscape, routines sit side by side. Safe-area insets are respected. The breakpoints that make this work are:
  - **Header** (child pages): below 640 px it has two rows. The first holds the child avatars on the left and the Parent Mode button on the right. The second is an equal-width, three-column row of page links, each with the icon above a one-line label. From 640 px everything sits on one row (links centered, icon above label), and from 1024 px the links go back to icon beside label. Targets are at least 72 px and at least 16 px apart at every width, and the current child is marked with a border and ring, never by scaling. On phones the Parent Mode button is drawn above the links but stays last in the DOM, so tab order is avatars, links, Parent Mode.
  - **Chart:** the routine cards use an auto-fit grid of 23 to 28 rem columns, centered. That gives one column on a phone, two on an iPad Air in either orientation, and three only when three cards fit (about 1200 px and up). A lone routine is never pushed to one side.
  - **Short screens** (landscape phones): at a viewport height of 520 px or less, the PIN pad, the Parent Mode gate and the Welcome screen put the title, dots and Back button on the left and the keypad on the right, so the keypad (72 px keys, 16 px apart) fits a 375 px-tall screen without scrolling. At 500 px or less the child picker tightens its spacing so both children fit without scrolling. Between 521 and 860 px tall (an iPhone 11 Pro in portrait, an iPad Air in landscape) the Welcome screen and the PIN card use tighter spacing and a smaller heading, so the whole PIN screen fits without scrolling on an 812 px-tall phone.
  - **Safe areas:** the `body` padding is the only source of insets for content in the normal flow, so child layouts add none of their own. Fixed elements ignore it and add their own `env(safe-area-inset-*)`: the Parent Mode bottom bar, the "Waiting for Wi-Fi" banner (top), the update toast, and the Sheet footer.
- **Get a Prize** (FR-11.1–11.6): selected stickers lift and show a check, with a large counter. The screen switches to "Waiting for grown-up" (with a cancel button) while a request is pending. Friendly empty states, as specified in the FDD.
- **Parent Mode button:** small, in a top corner, with the pending-requests badge (FR-11.11). Suggestion: press and hold for 1 s to open the PIN pad, so toddler taps don't keep triggering the shared lockout (I-12).
- **Kiosk use:** the runbook recommends iOS Guided Access or Android screen pinning on the child's tablet.
- **After a revoke** (FR-12.10): the routine card just shows its new progress. No sound, animation, or message. A pick that disappears under the child closes without a fuss.

**Parent review and revoke** (FR-12.1–12.8, day detail screen):

- An earned routine shows its sticker and a status chip (Unclaimed, Available, Pending, Used). Done tasks have a small "uncheck" affordance, which is hidden or disabled with an explanation when the sticker is Used.
- Tapping it opens a confirm sheet, not a browser dialog: the sticker (or "not picked yet"), the task, and the routine and day. If Pending: "This sticker is in a prize request. It will be taken out" (or "…and the request will be cancelled" when it's the last one). An optional note field (FR-12.11). The confirm button is red and labelled **Remove sticker**.
- On `409 STICKER_USED` the sheet explains that the prize was already given, and links to reversing the request when FR-11.14 is built.
- The confirm request is not optimistic: the sheet waits for the server, then the chart, Sticker Book, and pending-request queries are invalidated.
- A routine that is Ready to finish, today or on a past day, shows "All tasks done" and an **I'm Done!** button so the parent can finish it (FR-6.5). Its done tasks uncheck with no confirm sheet, because there is no sticker to remove (BR-19).
- A sticker with `autoFinished` shows a **Finished automatically** chip next to its status chip, and the History calendar marks the day the same way, so the parent can check that the tasks were really done (FR-6.11). Child Mode never shows this flag (I-25).

**Parent Mode layout** (touch targets here are at least 44 px):

- **Navigation:** below 768 px a fixed bottom bar with five equal-height items (labels may wrap to two lines, and the Prizes badge sits over the icon, so the bar never changes height); from 768 px a left sidebar. The page keeps room for the bar plus the bottom safe-area inset, and the update toast sits above the bar on phones.
- **History week** (FR-9.1): one column below 768 px, two from 768 px and three from 1024 px. There is no seven-column layout: the content column stops at 896 px, which would leave each day about 110 px wide, too narrow for the status chips. Chips wrap inside their card instead of spilling past its border.
- **Sheets:** the height is capped in `dvh`, not `vh`, so mobile browser chrome doesn't hide the bottom. The title and the footer stay pinned and only the body scrolls, so Save, Close and **Remove sticker** are always on screen, even on a 375 px-tall landscape phone.
- **Controls:** a native `<select>` is drawn with `appearance: none`, an explicit 44 px height and a background chevron, because WebKit ignores `min-height` on a native select. The weekday pills are 44 px circles that wrap onto a second row on narrow phones.

### 9.4 Celebrations and Sound (FR-6.4, FR-7.2, FR-7.8, FR-7.9)

- **Task done:** a small bounce and a "pop" sound.
- **Routine finished (I'm Done! tapped):** full-screen confetti (canvas-confetti) and a fanfare for about 2.5 s. Then the Sticker Pick shows three large cards, with artwork at least 160 px and the name underneath. Tapping one plays a "sticking" animation as it flies to the Sticker Book button (a Motion shared-layout animation).
- **Automatic finish:** no confetti or fanfare (FR-6.10). The sticker waits in the "Stickers to pick" tray, and opening it goes straight to the three cards. The "sticking" animation still plays when the child picks.
- **Reduced motion:** with `prefers-reduced-motion`, confetti becomes a gentle glow and fade.
- **Audio:** short, preloaded clips played through Web Audio. The audio context unlocks on the first tap, which iOS requires. Sound can be turned off per device.

### 9.5 PWA

- **Manifest:** name "Sticker Bank", `display: standalone`, `orientation: any`, `start_url` and `scope` of `/`, theme and background colors, 192 and 512 px icons plus a 512 px maskable icon, and an `apple-touch-icon`.
- **Service worker** (vite-plugin-pwa / Workbox): precaches the app shell, fonts, sounds, and every artwork file (about 2–3 MB as 256 px WebP), so the app opens instantly and pictures never pop in. It does **not** cache API responses (§9.6).
- **Updates:** `registerType: 'prompt'`. In Child Mode, a waiting update is applied at a safe moment (when the app comes back to the foreground, or at day rollover), never during a celebration. In Parent Mode, a "New version, reload" toast appears. The PWA compares `bootstrap.appVersion` with its own build version and checks for an update right away if they differ. **Min version (TD-20):** the PWA reads `X-Min-Frontend-Version` from every API response. When its own build version (`VITE_APP_VERSION`) is older, comparing only the numeric `x.y.z`, it checks for the new service worker at once and applies it at the first safe moment: Child Mode, no celebration, and no write in flight, rather than waiting for a foreground event. If no worker is waiting after 30 s, or applying one does not reload the page (a page no worker controls, such as after a hard refresh), it unregisters the workers, clears the caches and reloads, at most once per 10 minutes so a bad minimum cannot cause a reload loop. Parent Mode never reloads on its own: the toast says the app is out of date and its Reload button does the same. A dev build, a missing header or an unparseable version never forces a reload. Builds older than this feature cannot read the header and still rely on the safe-moment rule above.
- **Version footer:** the child layout, the parent layout and the child picker end with one small line, `App <build> · Server <bootstrap.appVersion>`. Both values are build times (TD-20), so a stale app shows two different numbers. The server value comes from bootstrap, which refetches every 30 s while the app is visible. The same value is available without the UI in `/api/bootstrap` (`appVersion`).
- **Install:** on Android and desktop Chrome, Parent → Settings shows an Install button (`beforeinstallprompt`). On iOS, it shows "Share → Add to Home Screen" instructions. An installed iOS PWA keeps its own cookies, so its parent session is separate from Safari's.
- **The origin must never change.** The installed app, its service worker, and the device preferences are all tied to the exact hostname. Choose it once (§12.4).

### 9.6 Offline Behavior (TD-7)

- Child Mode queries (bootstrap, today's chart, the Sticker Book) are persisted to IndexedDB through TanStack Query's persister, kept for up to 7 days. Parent data isn't persisted.
- When requests fail or the browser reports it's offline, the app greys out the last data, shows a friendly "Waiting for Wi-Fi…" cloud, and disables taps. TanStack's online manager retries with backoff and on the `online` event, and the app picks back up on its own.
- Writes are never queued. A tap during an outage fails gently and rolls back.
- Leaving API caching out of the service worker means the app always knows when it's offline. It can't mistake a cached response for a live one.

### 9.7 Artwork Pipeline (FR-3.2, FR-10.2, FR-10.3)

- `artwork/catalog.json` lists each image: `key`, default `name`, `tags`, `uses` (sticker, task, routine, avatar), `category`, and the source file. The images are curated from Fluent Emoji (3D), which has both the everyday objects tasks need (toothbrush, shoes, toilet, bath, book, bed…) and fun sticker subjects.
- `npm run artwork` converts the sources to 256 px WebP in `frontend/public/artwork/` and generates `catalog.ts`. The output is committed, since artwork changes rarely. The Docker build copies `catalog.json` into the backend's resources, so the API can reject unknown keys.
- The pickers (task icon, routine icon, avatar, sticker art) are searchable grids filtered by `uses`.
- **License:** Fluent Emoji is MIT-licensed. The license text ships at `/licenses/` and is linked from Parent → Settings.

### 9.8 Device Support

Current iPadOS/iOS Safari and Android Chrome, on tablets and phones. Vite's default build target ("Baseline widely available", roughly Safari 16+ and Chrome 107+) sets the minimum. That matters for hand-me-down tablets. If an older tablet has to work, add `@vitejs/plugin-legacy`.

### 9.9 Accessibility

Task tiles are real `<button>` elements with `aria-pressed`. Progress is announced through `aria-live`, including "All tasks done. Tap I'm Done!" when that button appears. Focus is trapped in dialogs and the PIN pad. Text contrast is at least 4.5:1 on every child theme color, because the palette is a fixed set checked at design time. A theme color is never used as the color of text (the palette measures only about 1.6 to 2.8:1 on white): counters and stat numbers are ink, and the theme shows up as a ring or badge behind them. Everything in Parent Mode works with a keyboard.

## 10. Backend Details

### 10.1 Layering

`Controller` (HTTP, DTO validation, working out the actor) → `Service` (transaction boundary, business rules, child lock) → `Repository` (Spring Data JDBC) or query classes (`JdbcClient`). Domain errors are thrown as `DomainException(code, httpStatus)` and turned into `ProblemDetail` responses by a single `@RestControllerAdvice`.

Main services: `FamilyClock`, `ChartService`, `CompletionService` (complete, undo, finish), `DaySettlement`, `StickerPickService`, `StickerBookService`, `RoutineService` (with `RevisionPolicy`), `PrizeRequestService`, `LibraryService`, `PinService`, `ParentSessionService`, `ArtworkCatalog`.

### 10.2 Validation Limits

| Field | Rule |
|---|---|
| Child name | 1–40 chars, trimmed |
| Routine name, task label | 1–60 chars |
| Tasks per routine | 0–30. Zero is allowed, but the routine won't appear on a chart (FR-3.5). |
| Days | At least 1 weekday. Use Pause to switch a routine off (I-14). |
| Colors | From the fixed palette |
| Artwork keys | Must exist in the catalog, with the right `uses` |
| PIN | Exactly 4 digits |
| Prize text / note | 1–200 / 0–500 chars |
| Sticker design name | 1–40 chars |
| Time zone | A valid IANA region ID |

### 10.3 Configuration

```yaml
# application.yaml (excerpt)
server:
  port: 8080
  shutdown: graceful
  forward-headers-strategy: framework
  compression:
    enabled: true
spring:
  datasource:
    hikari:
      maximum-pool-size: 8
      transaction-isolation: TRANSACTION_READ_COMMITTED
  flyway:
    enabled: true
management:
  server:
    port: 8081
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState,db
logging:
  structured:
    format:
      console: ecs
sticker-bank:
  parent-session:
    absolute-max: 12h
    cookie-secure: true              # false only for http://localhost development
  pin:
    attempts-before-lockout: 5
    cooldowns: [1m, 5m, 15m, 60m]
```

Supplied through the environment: `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`, `JAVA_TOOL_OPTIONS`. `APP_VERSION` is stamped at build time (the build's UTC time, `YYYY.MMDD.HHMMSS`, unless pinned with `--build-arg`). A Prometheus endpoint on 8081 is optional: add `micrometer-registry-prometheus` if the cluster runs Prometheus.

### 10.4 Migrations

- `V1__schema.sql` creates the tables and the single settings row. `V2__seed_sticker_library.sql` adds the categories, 24 designs, and the fallback design. `V3__reset_pin_procedure.sql` creates the procedure, using Flyway's MySQL `DELIMITER` support. `V4__sticker_revocation.sql` (§6.7) and `V5__routine_finish.sql` (§6.8) are the additive migrations for FDD v1.1 and v1.2.
- Migrations run at startup. Flyway's lock serializes pods that start at the same time.
- **Expand/contract:** a release may only add things (nullable or defaulted columns, new tables). Removals ship one release later. During a rolling update, the old pod keeps working against the new schema.

### 10.5 Logging

Structured JSON to stdout. Domain events are logged at INFO: sticker earned (with whether it was tapped or automatic), pick claimed, Prize Request created, completed, or cancelled, PIN set or changed, lockouts. PINs, tokens, and cookie values are never logged.

## 11. Security and Privacy

### 11.1 Threat Model

**Data:** children's first names, avatars, routines, and prize history. Low sensitivity, but personal, and about children. **Who might reach it:** the child (wandering into setup), guests on the home Wi-Fi, other devices on the LAN, and members of the VPN. The internet is excluded by design (TD-6).

### 11.2 Controls

| Area | Control |
|---|---|
| Network | Reachable only through an ingress on the LAN or VPN. NetworkPolicy allows the ingress controller to reach port 8080 on the pod, and the pod to reach MySQL on 3306 and DNS. Nothing else. The management port 8081 isn't part of the Service. |
| Transport | TLS at the ingress. HSTS added by the app's header filter. |
| Parent Mode | 4-digit PIN, hashed with BCrypt. Shared lockout with escalating cooldowns. Session tokens stored hashed, with idle and absolute expiry. Every `/api/parent/**` call is authorized on the server. |
| Child Mode | Open by design (A-2). It can only do what the child's screens can do. |
| CSRF | `SameSite=Strict` cookie, plus the required `X-Sticker-Bank` header on writes, plus no CORS. A page on another site can't send that header without a preflight request, and the server never approves preflights. |
| Browser | CSP `default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`. Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`. No third-party scripts, fonts, analytics, or CDNs. |
| Input | Bean Validation on every DTO. React escapes all text. No user-supplied HTML anywhere. |
| Container | Non-root UID 10001, read-only root filesystem (`/tmp` is an `emptyDir`), all Linux capabilities dropped, `seccompProfile: RuntimeDefault`, no service account token. |
| Database | The app's MySQL user is limited to the `sticker_bank` schema: data changes, the DDL Flyway needs, and `CREATE ROUTINE`, `ALTER ROUTINE`, `EXECUTE`. Credentials live in a Kubernetes Secret (Sealed Secrets, SOPS, or External Secrets if using GitOps). |
| Admin | A PIN reset requires MySQL credentials (TD-8). The audit row records the name given and the MySQL login. |
| Backups | They contain children's data, so they're encrypted or kept only on trusted storage. |

### 11.3 Why Not Spring Security

The only thing that ever authenticates is "a parent with the PIN". A small interceptor and a cookie service are easier to read and test than a custom Spring Security filter chain built for that one case. If separate caregiver profiles arrive (FDD §10), move to Spring Security then.

### 11.4 Accepted Risks

- Anyone on the home network or VPN can use Child Mode. This is accepted in A-2.
- A 4-digit PIN has 10,000 combinations. With the lockout schedule, guessing it would take weeks of non-stop trying from inside the network. That's enough against a toddler or a guest, which is the threat the FDD describes.
- After an Admin reset, whoever opens Parent Mode first sets the new PIN. The runbook says to reset only when the parent is ready with the device.
- BCrypt can't really protect a 4-digit PIN from someone who already has the database. Such a person already has all the data anyway. Hashing keeps the PIN out of plain sight in backups and logs.

## 12. Build and Deployment

### 12.1 Container Image

```dockerfile
# syntax=docker/dockerfile:1

# 0) The version of this build: the UTC build time unless --build-arg APP_VERSION pins one. Computed once, so the PWA
#    and the server carry the same value. The COPY makes BuildKit rerun the timestamp whenever the sources change.
FROM --platform=$BUILDPLATFORM alpine:3 AS version
ARG APP_VERSION=
COPY . /context
RUN printf '%s' "${APP_VERSION:-$(date -u +%Y.%m%d.%H%M%S)}" > /version

# 1) Build the PWA (runs on the build machine's own architecture)
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
COPY --from=version /version /version
RUN VITE_APP_VERSION="$(cat /version)" npm run build         # -> /src/frontend/dist

# 2) Build the Spring Boot jar with the PWA inside it
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk AS api
WORKDIR /src/backend
COPY backend/ ./
COPY --from=web /src/frontend/dist/ src/main/resources/static/
COPY artwork/catalog.json src/main/resources/artwork/catalog.json
COPY --from=version /version /version
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar -PappVersion="$(cat /version)" \
 && java -Djarmode=tools -jar build/libs/sticker-bank.jar extract --layers --launcher --destination /out

# 3) Runtime: JRE only, non-root
FROM eclipse-temurin:25-jre
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=api /out/dependencies/ ./
COPY --from=api /out/spring-boot-loader/ ./
COPY --from=api /out/snapshot-dependencies/ ./
COPY --from=api /out/application/ ./
USER 10001:10001
EXPOSE 8080 8081
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60"
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

- The two build stages run on the build machine's own architecture (`--platform=$BUILDPLATFORM`). JavaScript and JVM bytecode are portable, so only the small runtime stage differs per architecture. Build with `docker buildx build --platform linux/amd64,linux/arm64`.
- Tests don't run inside the image build, because Testcontainers needs Docker. CI runs them first (§12.7).
- The app version is the build time, so no two builds share one (TD-20). Tag images with a tag you have never used, such as the build time or the commit plus the time. Never use `latest` in manifests.

### 12.2 Kubernetes Resources

```
deploy/k8s/
├── base/               namespace, deployment, service, configmap, networkpolicy, kustomization
├── overlays/home/      image tag, ingress (option A or B), secret reference
└── optional/mysql/     StatefulSet, PVC, Service, backup CronJob
```

| Resource | Notes |
|---|---|
| Namespace | `sticker-bank` |
| Deployment | 1 replica. The app is stateless, so 2 also works. RollingUpdate with `maxSurge: 1`, `maxUnavailable: 0`. |
| Service | ClusterIP, port 80 → 8080 only |
| Ingress | §12.4 |
| ConfigMap | Non-secret environment: datasource URL, JVM options |
| Secret | Database username and password |
| NetworkPolicy | As in §11.2 |

```yaml
# base/deployment.yaml (excerpt)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sticker-bank
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  selector:
    matchLabels: { app.kubernetes.io/name: sticker-bank }
  template:
    metadata:
      labels: { app.kubernetes.io/name: sticker-bank }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: app
          image: registry.example/sticker-bank:1.0.0
          ports:
            - { name: http, containerPort: 8080 }
            - { name: management, containerPort: 8081 }
          envFrom:
            - configMapRef: { name: sticker-bank-config }
            - secretRef: { name: sticker-bank-db }
          resources:
            requests: { cpu: 100m, memory: 512Mi }
            limits: { memory: 640Mi }        # no CPU limit: it throttles JVM startup
          startupProbe:
            httpGet: { path: /actuator/health/liveness, port: management }
            periodSeconds: 5
            failureThreshold: 36             # up to 3 minutes on slow nodes
          livenessProbe:
            httpGet: { path: /actuator/health/liveness, port: management }
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /actuator/health/readiness, port: management }
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
```

Liveness doesn't include the database, so a MySQL outage doesn't send the pod into a restart loop. Readiness does include it, so traffic stops while the database is unreachable and the PWA shows its offline state.

### 12.3 MySQL

- **Version:** MySQL 8.4 LTS.
- **Default: bring your own.** Use an existing server or operator, and create the database and user:

  ```sql
  CREATE DATABASE sticker_bank CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER 'sticker_bank'@'%' IDENTIFIED BY '<from your secret store>';
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES,
        CREATE ROUTINE, ALTER ROUTINE, EXECUTE
     ON sticker_bank.* TO 'sticker_bank'@'%';
  ```

- **Optional in-cluster MySQL** (`deploy/k8s/optional/mysql/`): a single-instance StatefulSet (`mysql:8.4`) with a 5 Gi PVC and a ClusterIP Service. That's plenty for one family. The data grows by a few MB a year.
- **Datasource URL:** `jdbc:mysql://<host>:3306/sticker_bank?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true`
- **Backups:** a nightly CronJob runs `mysqldump --single-transaction --routines --triggers sticker_bank` and writes a compressed file to a NAS, PVC, or S3-compatible bucket, kept for 30 days. `--routines` matters: it's how `reset_parent_pin` gets restored. Test a restore once before relying on it. Recovery point: 24 hours.

### 12.4 Ingress and TLS (LAN / VPN Only)

Service workers need HTTPS, so both options provide a real certificate.

| | Option A: LAN ingress + cert-manager | Option B: Tailscale Kubernetes operator |
|---|---|---|
| URL | `https://stickers.home.example.com` | `https://sticker-bank.<tailnet>.ts.net` |
| Reachable from | Home Wi-Fi. Away from home, over your VPN into the LAN. | Any device running Tailscale, at home or away |
| TLS | Let's Encrypt DNS-01 through cert-manager. No inbound internet access needed. | Automatic Tailscale certificates |
| Needs | An ingress controller on a LAN-only IP (MetalLB or kube-vip), plus a DNS record | The Tailscale app on every family device, including the child's tablet |

For option A, use Traefik or a Gateway API implementation (ingress-nginx has been retired).

```yaml
# Option A: LAN ingress with cert-manager
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sticker-bank
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-dns
spec:
  ingressClassName: traefik
  tls:
    - hosts: [stickers.home.example.com]
      secretName: sticker-bank-tls
  rules:
    - host: stickers.home.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: sticker-bank, port: { name: http } }
---
# Option B: Tailscale operator
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sticker-bank
spec:
  ingressClassName: tailscale
  defaultBackend:
    service: { name: sticker-bank, port: { name: http } }
  tls:
    - hosts: [sticker-bank]
```

Whichever option you choose, **keep the hostname forever** (§9.5).

### 12.5 Local Development

Neither mode needs a database server that you install or keep running (TD-16).

| Mode | Command | What runs | Use it for |
|---|---|---|---|
| **UI only** | `npm run dev:mock` | Vite, with an in-browser mock API (MSW). No Java, no database. | Toddler screens, celebrations, parent forms, edge-case states |
| **Full stack** | `./gradlew bootTestRun`, then `npm run dev` | Spring Boot with a throwaway MySQL 8.4 container. Vite proxies `/api` to `localhost:8080`. | Anything that touches business rules, the API, or the schema |

**Full stack.** Spring Boot's Testcontainers development mode starts MySQL 8.4 in a container when the app starts, points the datasource at it (`@ServiceConnection`), runs the Flyway migrations, and loads a demo family. The only prerequisite is a container runtime. OrbStack and Docker Desktop work with Testcontainers out of the box. Colima needs a couple of environment variables (see the Testcontainers docs). The same runtime builds the image locally (§12.1).

```kotlin
// backend/src/test/kotlin/com/stickerbank/dev/TestStickerBankApplication.kt
fun main(args: Array<String>) {
    fromApplication<StickerBankApplication>()
        .with(MySqlContainerConfig::class, DemoDataSeeder::class)
        .run("--spring.profiles.active=dev", *args)
}

@TestConfiguration(proxyBeanMethods = false)
class MySqlContainerConfig {
    @Bean
    @ServiceConnection
    @RestartScope // keep the container across DevTools restarts
    fun mysql() = MySQLContainer(DockerImageName.parse("mysql:8.4"))
}
```

- **It lives in the test source set,** so none of it (the container config, the demo seeder, the demo PIN) can end up in the production image.
- **Fresh data on every run.** `DemoDataSeeder` fills the empty database with a demo family: PIN `1234`, two children, Morning and Bedtime routines, two weeks of history, stickers in every status, and one pending Prize Request. To keep your data between runs instead, turn on Testcontainers reuse (`testcontainers.reuse.enable=true` in `~/.testcontainers.properties`, plus `.withReuse(true)` on the container). A reused container keeps running after the app stops, until you remove it.
- **Same database as the tests.** The integration tests import the same `MySqlContainerConfig`, so dev, tests, and CI all run the same MySQL image and the same migrations.
- **Gradle setup:** DevTools goes in the `testAndDevelopmentOnly` configuration, so `@RestartScope` works under `bootTestRun`. The `dev` profile sets `cookie-secure: false`, for browsers that reject `Secure` cookies on `http://localhost`.

**UI only.** MSW intercepts `/api` requests in the browser and answers them from an in-memory fake. The fake is typed with the generated OpenAPI types, so if it drifts from the real API, `tsc` fails. It covers only the main rules: a routine becomes Ready to finish when every task is done, I'm Done! earns the sticker, the 3-choice pick, sticker statuses, and one pending request per child. The backend tests prove the real rules. Named scenarios set the starting state from the URL: `?scenario=fresh-install` (PIN setup), `one-task-left`, `ready-to-finish`, `pick-waiting`, `auto-finished` (a sticker from yesterday waiting in the tray), `empty-library` (fallback sticker), `pending-request`, `offline`. Vitest uses the same handlers. The PWA service worker is off in dev, so it doesn't clash with MSW's worker, and `mockServiceWorker.js` is left out of production builds.

**PWA behavior** (service worker, install, updates): test with `npm run build && npm run preview`, or against a deployed build. To try the app on a real tablet, deploy to a dev namespace or go through Tailscale, because the tablet needs HTTPS for the service worker.

**Why not SQLite or H2.** Either would remove the need for a container runtime, but only by adding a second SQL dialect. SQLite has no row locks (`SELECT … FOR UPDATE`), no `ON DUPLICATE KEY UPDATE`, no `ENUM`, no stored procedures, and no date types. It doesn't enforce `VARCHAR` lengths, leaves foreign keys off by default, and has no Spring Data JDBC dialect. H2's MySQL mode is closer, but it has no stored procedures and differs in collation and built-in functions. With either one, the locking and constraint code that protects sticker counts (§7.1) would behave differently in dev than in production.

### 12.6 Runbooks (to write in `docs/runbooks/`)

| Runbook | Steps |
|---|---|
| **Reset the parent PIN** (FR-8.8) | 1. Make sure the parent is ready to set a new PIN right away (§11.4). 2. `kubectl -n <mysql-namespace> exec -it <mysql-pod> -- mysql -u <admin-user> -p sticker_bank -e "CALL reset_parent_pin('Your Name');"`. 3. On any device, open Parent Mode and create the new PIN. 4. Audit trail: `SELECT * FROM pin_reset_log ORDER BY reset_at DESC;` |
| **Back up and restore** | Where the dumps are, how to restore into an empty database, and how to check the result. |
| **Upgrade** | Bump the image tag in `overlays/home`. The rolling update runs migrations on startup. |
| **Lock the child's tablet to the app** | iOS Guided Access, Android screen pinning. |
| **Change the time zone** | Parent → Settings. What changes, and what doesn't. |

### 12.7 CI/CD (Suggested)

1. Lint: ktlint, detekt, ESLint, `tsc`.
2. Backend tests with Testcontainers, plus the OpenAPI drift check.
3. Frontend unit tests.
4. Build the multi-arch image and push it to your registry.
5. End-to-end tests: Playwright against `compose`, using the new image and MySQL.
6. Deploy: bump the image tag in `overlays/home`, directly or through Argo CD or Flux.

## 13. Testing Strategy

| Level | Tools | Focus |
|---|---|---|
| Backend unit | JUnit, MockK, fixed `Clock`, seeded `Random` | `RevisionPolicy`, weekday masks, `ChartRules.deriveState` (including `READY_TO_FINISH` on today and on past days), pick generation (including pools of fewer than 3 and of 0), lockout escalation, DST and midnight boundaries, the settlement day range and the end-of-day `earned_at` |
| Backend integration | `@SpringBootTest` + Testcontainers MySQL 8.4 | One test per business rule (§15.2), full flows, the `reset_parent_pin` procedure, child-deletion cascades, migrations from an empty database and `V4` over a V3 database with data. Revoke from each status (Unclaimed, Available, Pending as one of several, Pending as the last, Used rejected), then re-earn and get the same choices back (also after more than one revoke, and when a design was retired in between). Every `live_sticker` read with a revoked row present. Finish (§7.4): the last task earns nothing, undo while Ready to finish is a plain delete, finish earns exactly one sticker and a second call returns the same choices, `ROUTINE_NOT_READY`, and a routine edit that leaves every task done earns nothing (I-3). Settlement (§7.12): an ended day with every task done gets an `AUTO` sticker with `earned_at` at the end of the day, while partly done and skipped routines don't, catching up after a multi-day gap, a `NULL` watermark, a parent's later edit of a settled past day stays Ready to finish, and a revoke today followed by a re-check is auto-finished at the end of the day. `V5` over a V4 database with data, where the `live_sticker` view exposes `finish_mode`. |
| Concurrency | Integration tests with parallel threads | Two devices tap I'm Done! at the same moment: exactly one sticker, and both get the same choices. A finish racing the first request after midnight: exactly one sticker. Two Prize Requests at once: one wins. Two claims: one design. Revoke against claim, against completing the request, and against the child re-finishing the routine: the result always matches one serial order, and there is never more than one live sticker per routine and day. |
| Contract | OpenAPI snapshot | Spec drift fails CI. Frontend types are regenerated from it. |
| Frontend unit | Vitest, React Testing Library, MSW, fake timers | Task tile states and the double-tap guard, the I'm Done! button (shown only for `READY_TO_FINISH`, ignores taps for its first 600 ms, disappears when a task is unchecked), the pick and reloading it, prize selection, the idle timeout, day rollover, the offline state |
| End-to-end | Playwright with iPad and phone profiles, touch enabled | First run. Earn (last task → I'm Done! → pick → Sticker Book). Tap a task by mistake, undo it, then finish. Reload while Ready to finish keeps the button. Reload in the middle of a pick keeps the choices. Prize Request lifecycle. Past-day fix (check the last task, then I'm Done!). Revoke today → child re-taps → I'm Done! → pick with the same choices. Revoke a Pending sticker. PIN lockout. Admin reset → new PIN. |
| Manual | A real iPad and Android tablet, with the app installed | Installing, sounds, the offline state, the update flow, Guided Access |

## 14. Non-Functional Targets

| Area | Target |
|---|---|
| Responsiveness | Tap feedback under 50 ms (optimistic). API p95 under 200 ms on the LAN. The installed PWA shows the chart within 2 s of launch. |
| Scale | 1 family, up to 6 children, 10 routines per child, 30 tasks per routine, and 10 devices. |
| Footprint | 1 pod with about 400–600 MiB of memory and a 100m CPU request. MySQL stays under 100 MB for years. |
| Availability | Home-lab best effort. Rolling updates without downtime. The offline state covers short outages. |
| Durability | Nightly backups, so at most 24 hours of data can be lost. |

## 15. Requirements Traceability

### 15.1 Functional Areas

| FDD section | Data | API | UI |
|---|---|---|---|
| §6.1 Child Profiles | `child` | `/api/parent/children` | Parent → Children, child switcher |
| §6.2 Routine Management | `routine`, `routine_revision` | `/api/parent/…/routines` | Routine list and editor |
| §6.3 Task Management | `task`, `revision_task` | Routine save (`PUT`) | Routine editor (dnd-kit) |
| §6.4 Scheduling | `days_mask`, `routine_skip` | Routine save, skips | Editor, history day view |
| §6.5 Daily Chart | Read model over revisions | `/days/{date}` | Daily Chart |
| §6.6 Completing Tasks | `task_completion` (Ready to finish is derived) | `PUT` / `DELETE …/tasks/{id}`, `POST …/routines/{id}/finish` | Task tiles, I'm Done! button |
| §6.7 Earning Stickers | `sticker` (with `finish_mode`), `sticker_pick_choice`, `child.settled_through` | Finish response, `/pick`, day settlement (§7.12) | Celebration, Sticker Pick, "Stickers to pick" tray, Sticker Book |
| §6.8 Modes and PIN | `family_settings`, `parent_session`, `pin_reset_log` | `/api/parent/pin`, `/api/parent/session` | PIN pad, route guard, idle timer |
| §6.9 History | Revisions, completions, stickers | `/history` | Calendar |
| §6.10 Sticker Library | `sticker_design`, `sticker_category` | `/api/parent/library` | Library page |
| §6.11 Prize Requests | `prize_request`, `prize_request_item` | Prize Request endpoints | Get a Prize, Prize Requests page |
| §6.12 Sticker Review & Revocation | `sticker.status = REVOKED`, `sticker_revocation`, `prize_request.cancel_reason` | `DELETE …/tasks/{id}?revokeSticker=true`, chart `sticker` object, `/history` `revocations` | History day detail, confirm sheet |

### 15.2 Business Rules

| Rule | Enforced by |
|---|---|
| BR-1 | `task_completion` keyed by (task, date), with child and routine columns |
| BR-2 | `RevisionPolicy`: an edit applies from today, or from tomorrow if today's sticker exists (§6.4) |
| BR-3 | Routines are soft-deleted through revisions. Stickers keep a snapshot of the routine name and icon. |
| BR-4 | A Child Mode write (task or finish) for a past date → `409 DAY_CHANGED` |
| BR-5 | Any write for a future date → `422 FUTURE_DATE` |
| BR-6 | Choices saved in `sticker_pick_choice` when the sticker is earned. `GET …/pick` only reads them. A claim and a revoke both keep them, and a re-earn copies the latest revoked sticker's rows onto the new sticker row (§7.5 step 2). |
| BR-7 | `UNIQUE (routine_id, chart_date, is_live)` on `sticker`, which ignores revoked rows (§6.7), plus the child lock |
| BR-8 | Choices point at live design rows. The claim doesn't check design status. |
| BR-9 | Designs are retired through `status`. Sticker Books point at the live design row. Deletion is `RESTRICT`. |
| BR-10 | A sticker must be `AVAILABLE` to join a request, checked under the child lock |
| BR-11 | No `PENDING` request may exist for the child, checked under the child lock, for both child- and parent-created requests |
| BR-12 | No value column anywhere. Counts are `COUNT(*)`. |
| BR-13 | The request's child must match every sticker's child |
| BR-14 | `child` → `prize_request` cascades. Retiring a design never touches requests. |
| BR-15 | Foreign keys from `sticker` and `sticker_pick_choice` to `sticker_design` are `RESTRICT` → `409 DESIGN_IN_USE`. Revoked stickers still count, and so do designs that were only ever offered in a kept pick (I-16). |
| BR-16 | Revoke only on `DELETE …/tasks` with a parent session and `revokeSticker=true`. Without a session it's always `409 ROUTINE_LOCKED`. |
| BR-17 | `REVOKED` is excluded by the `live_sticker` view from the Sticker Book, counts, and charts. The sticker leaves its Pending request. `USED` → `409 STICKER_USED`. |
| BR-18 | Only the finish endpoint (§7.4) and day settlement (§7.12) call the earn routine (§7.5). Completing a task, saving a routine, and revoking never do. Settlement skips days up to `child.settled_through`, and skipped routines. |
| BR-19 | `READY_TO_FINISH` is derived: no live sticker and every task done (§7.3), so there is no row to clean up. Undo on it is a plain delete of the completion (§7.4). At the end of the day, settlement finishes it (§7.12). |

### 15.3 Priorities

- **Must:** all built in v1.
- **Should:** fully designed in this document, and built in v1 if time allows (§18).
- **Could:** room is left for them, but they aren't built. FR-1.4 uses `child.archived_at`. FR-3.6 uses `revision_task.days_mask`. FR-7.12 uses `sticker.source = BONUS` with no routine. FR-11.14 uses the `REVERSED` status. FR-12.11 uses `sticker_revocation.note`. FR-2.7 templates are static frontend data. FR-5.7 and FR-9.3 only read existing data.

## 16. Interpretations of the FDD

The FDD doesn't settle these points. This design makes the following choices.

| # | Topic | Interpretation | FDD |
|---|---|---|---|
| I-1 | Whose "local midnight" | The family's time zone, stored on the server. It's taken from the device when the PIN is first set and can be changed in Settings. All devices share one "today". | FR-4.4 |
| I-2 | Unclaimed stickers from earlier days | The "Pick your sticker!" button sits on the routine card, but Child Mode only shows today. Unclaimed stickers from earlier days (including ones earned by a parent's past-day fix) appear in a **"Stickers to pick"** tray on the Daily Chart. | FR-7.10, FR-6.5 |
| I-3 | An edit that leaves every task done | If a parent removes the only unfinished tasks from today's routine, every remaining task is done, so the routine becomes Ready to finish. It earns nothing until I'm Done! is tapped or the day ends. | FR-7.1, BR-2, BR-18 |
| I-4 | Deleting a design that's waiting in a pick | Not allowed, only retiring. Otherwise a saved pick would change. | FR-10.6, BR-6, BR-8 |
| I-5 | Skipped routines in Child Mode | Hidden from the child's Daily Chart. Shown as Skipped in history. | FR-4.5 |
| I-6 | Routine order on past days | Order isn't versioned. Past days are shown in the current order. | FR-2.4, FR-4.3 |
| I-7 | PIN lockout scope and length | Shared by all devices. Cooldowns grow with repeated lockouts: 1, 5, 15, then 60 minutes. | FR-8.7 |
| I-8 | Parent Mode inactivity period | 5 minutes by default, adjustable in Settings. | FR-8.4 |
| I-9 | Renamed routines in the Sticker Book | The routine name and icon are saved with the sticker when it's earned, so renaming a routine doesn't rewrite history. Design name and image changes *do* show everywhere, as FR-10.4 requires. | FR-7.5, FR-10.4 |
| I-10 | "Total earned" | Counts picked stickers (Available + Pending + Used). Unclaimed stickers are shown separately. | FR-7.6 |
| I-11 | Past days in Child Mode | The API lets anyone read past days, but writing to them needs Parent Mode. The child's screens only show today. | BR-4 |
| I-12 | Opening Parent Mode | Suggestion: press and hold the Parent button for 1 s to open the PIN pad, so toddler taps don't keep locking everyone out. | FR-8.3, FR-8.7 |
| I-13 | Fallback sticker | A built-in "Gold Star", hidden from the library, that can't be edited, retired, or deleted. | FR-7.11, FR-10.1 |
| I-14 | Routine with no days selected | Not allowed. Use Pause instead. | FR-4.1, FR-2.6 |
| I-15 | Which days can be skipped | Any day (past, today, or future) on which the routine has no live sticker. | FR-4.5 |
| I-16 | Deleting a design that was only on revoked stickers, or was only ever offered | Not allowed. A design that was once earned stays pointed at by the revoked row, and a design that was offered stays in the kept `sticker_pick_choice` rows, which a re-earn may offer again. Retire it instead. The `RESTRICT` foreign keys enforce both, and `in_use` already counts every `sticker_pick_choice` row. | FR-10.6, BR-15, FR-12.5 |
| I-17 | Confirming a revoke | The server requires an explicit `revokeSticker=true` flag, so a stray Parent Mode tap can never revoke. Without it, the parent gets the sticker back for the confirm sheet. | FR-12.3 |
| I-18 | Which task is recorded | The one the parent unchecked. Unchecking more tasks afterwards is an ordinary undo, because the sticker is already gone. | FR-12.9 |
| I-19 | Where the parent revokes | History day detail, which covers today and past days. The child's Daily Chart in Child Mode never offers it. | FR-12.2, BR-16 |
| I-20 | A request emptied by revokes | Cancelled with `cancel_reason = ALL_STICKERS_REVOKED`, shown in history as "Cancelled: stickers removed". | FR-12.6 |
| I-21 | Ready to finish isn't stored | It is derived from the saved completions and the absence of a live sticker, so closing the app, reloading, or switching devices keeps it, and an undo has nothing to clean up. | FR-6.7, FR-6.9, BR-19 |
| I-22 | When "the day ends" is applied | Lazily, by settlement (§7.12), the first time that child is touched after midnight. The sticker's `earned_at` is set to the end of the day, so the result is the same whenever it runs. | FR-6.10 |
| I-23 | Skipped routines at day end | Not finished automatically, because a skipped routine counts as neither missed nor earned. | FR-4.5, FR-6.10 |
| I-24 | Editing a day that has already been settled | The watermark has passed it, so the routine stays Ready to finish until a parent taps I'm Done!. This includes re-checking a task after revoking a past day's sticker. | FR-6.5, FR-6.10 |
| I-25 | Who sees the auto-finished flag | Only a parent session (the chart `sticker.autoFinished` and History). Child Mode treats the sticker like any other unclaimed one. | FR-6.11 |
| I-26 | Raising the minimum frontend version | Takes effect on each device's next API call. Every build has its own version (its build time), so a new deploy always raises the minimum above the previous build's. A rollback lowers it, and newer apps are fine. A minimum no served build can meet costs at most one reload per 10 minutes per device. An explicit `--build-arg APP_VERSION` replaces the timestamp and must then be raised by hand, because builds with the same version cannot be told apart. Each new version also resets the persisted offline cache (its `buster` is the build version, §9.6). | TD-20 |

## 17. Open Questions

| # | Question | Default if unanswered |
|---|---|---|
| OQ-1 | Ingress option A (LAN + cert-manager) or B (Tailscale), and the permanent hostname | None: this has to be decided before the first install, because the PWA is tied to its origin. |
| OQ-2 | An existing MySQL server, or the optional in-cluster StatefulSet? | Existing server |
| OQ-3 | Container registry and CI system | GitHub Actions pushing to GHCR |
| OQ-4 | Is Fluent Emoji 3D the right look for stickers and icons? | Yes |
| OQ-5 | Confirm I-2 (the "Stickers to pick" tray, which also holds auto-finished stickers) and I-3 (an edit can make a routine Ready to finish). | As written |
| OQ-6 | Confirm I-16 (designs on revoked stickers can't be deleted). | As written |
| OQ-7 | Confirm I-22 (lazy settlement at the first request after midnight, instead of a scheduled job). | As written |

## 18. Implementation Plan

| Milestone | Scope | Done when |
|---|---|---|
| **M0** Walking skeleton | Repository, Gradle + Vite, both dev modes (`bootTestRun`, `dev:mock`), Dockerfile, compose, CI, Kustomize base, health probes, an installable empty PWA | `./gradlew bootTestRun` works with nothing installed but a container runtime, and the empty PWA installs on the child's tablet over HTTPS from the cluster |
| **M1** Setup and library | Schema, PIN setup and unlock, sessions, idle timeout and lockout (FR-8.4, FR-8.7), the reset procedure and log (FR-8.10), child profiles, artwork pipeline, Sticker Library | A parent can set a PIN, add children, and manage stickers |
| **M2** Routines and chart | Routine editor with revisions, schedules, ordering, reading the Daily Chart | Charts show the right routines for each weekday, and edits follow BR-2 |
| **M3** Earning | Task completion, celebrations, Sticker Pick, Sticker Book | The full earning flow works on a tablet, and the concurrency tests pass |
| **M4** Spending | Get a Prize, the Prize Requests page and its history | The full spending flow works, and the BR-10 and BR-11 tests pass |
| **M4.5** Revocation | `V4` migration, `live_sticker` reads, revoke flow (§7.11), confirm sheet, FR-12.1–12.8 | Revoke from every status works or is rejected as specified, re-earning offers the same choices, and the BR-16, BR-17 and revoke concurrency tests pass |
| **M4.6** Finish step | `V5` migration and `live_sticker` refresh, `READY_TO_FINISH`, the finish endpoint, the I'm Done! button, `DaySettlement`, the tray and parent chip for auto-finished stickers, FR-6.6–6.10 | The last task earns nothing, a mistaken tap can be undone before I'm Done!, a routine left Ready to finish overnight is auto-finished exactly once, and the BR-18 and BR-19 tests pass |
| **M5** History and hardening | Calendar, offline state, update flow, accessibility pass, end-to-end suite, runbooks | Every Must is done, and end-to-end tests pass on iPad and phone profiles |
| **M6** Remaining Shoulds | FR-2.5, FR-2.6, FR-4.5, FR-5.6, FR-6.4, FR-6.5, FR-6.11, FR-9.2, FR-10.8, FR-10.9, FR-11.6, FR-11.11–11.13, FR-11.17, FR-11.18, FR-12.9, FR-12.10 | All tested |
