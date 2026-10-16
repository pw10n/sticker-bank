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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO family_settings (id, updated_at) VALUES (1, UTC_TIMESTAMP(3));

CREATE TABLE parent_session (
  id           BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token_hash   BINARY(32)  NOT NULL,                     -- SHA-256 of the cookie value
  created_at   DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  CONSTRAINT uq_parent_session_token UNIQUE (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pin_reset_log (                             -- FR-8.10
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reset_at   DATETIME(3)  NOT NULL,
  admin_name VARCHAR(100) NOT NULL,
  db_user    VARCHAR(288) NOT NULL                       -- MySQL login that ran the reset
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE child (
  id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(40) NOT NULL,
  avatar_key  VARCHAR(64) NOT NULL,
  theme_color VARCHAR(16) NOT NULL,
  position    INT         NOT NULL,
  archived_at DATETIME(3) NULL,                          -- FR-1.4 (Could), unused in v1
  created_at  DATETIME(3) NOT NULL,
  updated_at  DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE routine (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  child_id   BIGINT      NOT NULL,
  position   INT         NOT NULL,                       -- FR-2.4, not versioned
  created_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,                           -- hides it from the parent's list
  CONSTRAINT fk_routine_child FOREIGN KEY (child_id) REFERENCES child (id) ON DELETE CASCADE,
  INDEX ix_routine_child (child_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE task (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  routine_id BIGINT      NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_task_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE routine_skip (                              -- FR-4.5
  routine_id BIGINT      NOT NULL,
  chart_date DATE        NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (routine_id, chart_date),
  CONSTRAINT fk_skip_routine FOREIGN KEY (routine_id) REFERENCES routine (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sticker_category (                          -- FR-10.9
  id       BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(40) NOT NULL,
  enabled  BOOLEAN     NOT NULL DEFAULT TRUE,            -- turns a whole pack on or off
  position INT         NOT NULL,
  CONSTRAINT uq_category_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sticker_pick_choice (                       -- BR-6: saved once, never regenerated
  sticker_id BIGINT  NOT NULL,
  slot       TINYINT NOT NULL,                           -- 1–3, display order
  design_id  BIGINT  NOT NULL,
  PRIMARY KEY (sticker_id, slot),
  CONSTRAINT uq_choice_design  UNIQUE (sticker_id, design_id),                       -- 3 different stickers (FR-7.7)
  CONSTRAINT fk_choice_sticker FOREIGN KEY (sticker_id) REFERENCES sticker (id)        ON DELETE CASCADE,
  CONSTRAINT fk_choice_design  FOREIGN KEY (design_id)  REFERENCES sticker_design (id) ON DELETE RESTRICT  -- I-4
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE prize_request_item (
  prize_request_id BIGINT NOT NULL,
  sticker_id       BIGINT NOT NULL,
  PRIMARY KEY (prize_request_id, sticker_id),
  CONSTRAINT fk_item_request FOREIGN KEY (prize_request_id) REFERENCES prize_request (id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sticker FOREIGN KEY (sticker_id)       REFERENCES sticker (id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
