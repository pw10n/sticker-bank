-- 1) One row per chore (FDD §6.13). There are no revisions: until a chore is finished
--    it has no history to protect, and once it is finished it can't be edited (BR-22).
CREATE TABLE chore (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  child_id   BIGINT      NOT NULL,
  name       VARCHAR(60) NOT NULL,
  icon_key   VARCHAR(64) NOT NULL,
  due_date   DATE        NULL,                         -- the last day it can be done; NULL = no due date (FR-13.2)
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  removed_at DATETIME(3) NULL,                         -- soft delete (I-33)
  CONSTRAINT fk_chore_child FOREIGN KEY (child_id) REFERENCES child (id) ON DELETE CASCADE,
  INDEX ix_chore_child_due (child_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2) A chore's tasks (FR-13.1), 1 to 6 per chore. The check lives on the row, not in
--    task_completion: a chore isn't tied to a day, so there is no chart_date to key it by (BR-23).
CREATE TABLE chore_task (
  id         BIGINT                 NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chore_id   BIGINT                 NOT NULL,
  position   INT                    NOT NULL,
  label      VARCHAR(60)            NOT NULL,
  icon_key   VARCHAR(64)            NOT NULL,
  checked_at DATETIME(3)            NULL,              -- set while checked; cleared by undo and by revoke
  checked_by ENUM('CHILD','PARENT') NULL,
  CONSTRAINT fk_chore_task_chore FOREIGN KEY (chore_id) REFERENCES chore (id) ON DELETE CASCADE,
  INDEX ix_chore_task_chore (chore_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3) A third sticker source. Appending to the end of an ENUM is an instant change in MySQL 8.
ALTER TABLE sticker
  MODIFY source ENUM('ROUTINE','BONUS','CHORE') NOT NULL;

-- 4) BR-20: one live sticker per chore. This is the same shape as uq_sticker_live_routine_day (V4).
--    is_live is NULL for revoked rows and chore_id is NULL for every other sticker, and NULLs
--    never collide in a UNIQUE index. Chores are only hard-deleted together with their child
--    (I-33), so this cascade never removes stickers from a child who still exists.
ALTER TABLE sticker
  ADD COLUMN chore_id BIGINT NULL,
  ADD CONSTRAINT fk_sticker_chore FOREIGN KEY (chore_id) REFERENCES chore (id) ON DELETE CASCADE,
  ADD CONSTRAINT uq_sticker_live_chore UNIQUE (chore_id, is_live);    -- also indexes fk_sticker_chore

-- 5) As in V5: the view has to be redefined before it shows chore_id.
CREATE OR REPLACE VIEW live_sticker AS
  SELECT * FROM sticker WHERE status <> 'REVOKED';
