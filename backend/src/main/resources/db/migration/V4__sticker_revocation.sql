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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
