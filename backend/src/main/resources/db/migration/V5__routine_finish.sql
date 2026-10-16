-- FDD v1.2 (FR-6.6 to FR-6.11): a routine only earns its sticker when I'm Done! is tapped,
-- or when the day ends with the routine still Ready to finish (TDD 6.8, 7.12).
-- Both columns are additive and nullable, so this is safe during a rolling update (TD-3).

-- 1) How the sticker was finished (FR-6.11). NULL for stickers earned before this
--    migration, which the last task earned, and for bonus stickers.
ALTER TABLE sticker
  ADD COLUMN finish_mode ENUM('TAPPED','AUTO') NULL;

-- 2) The last day whose end-of-day auto-finish has been applied (TDD 7.12).
--    NULL = never settled, which means nothing before today is waiting.
ALTER TABLE child
  ADD COLUMN settled_through DATE NULL;

-- 3) MySQL expands SELECT * when a view is created, so live_sticker (V4) doesn't see
--    the new column until the view is redefined.
CREATE OR REPLACE VIEW live_sticker AS
  SELECT * FROM sticker WHERE status <> 'REVOKED';
