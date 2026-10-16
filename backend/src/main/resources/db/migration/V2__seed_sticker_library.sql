-- Starter sticker library: 4 categories, 24 designs, plus the hidden fallback design.

INSERT INTO sticker_category (name, enabled, position) VALUES
  ('Animals', TRUE, 1),
  ('Space', TRUE, 2),
  ('Food', TRUE, 3),
  ('Vehicles', TRUE, 4);

INSERT INTO sticker_design (name, artwork_key, category_id, status, is_fallback, created_at, updated_at) VALUES
  ('Happy Whale', 'whale', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Lion', 'lion', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Panda', 'panda', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Unicorn', 'unicorn', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('T-Rex', 't-rex', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Octopus', 'octopus', (SELECT id FROM sticker_category WHERE name = 'Animals'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Rocket', 'rocket', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Ringed Planet', 'ringed-planet', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Shooting Star', 'shooting-star', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Alien', 'alien', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Crescent Moon', 'crescent-moon', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Flying Saucer', 'flying-saucer', (SELECT id FROM sticker_category WHERE name = 'Space'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Taco', 'taco', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Pizza', 'pizza', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Ice Cream', 'ice-cream', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Strawberry', 'strawberry', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Doughnut', 'doughnut', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Watermelon', 'watermelon', (SELECT id FROM sticker_category WHERE name = 'Food'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Race Car', 'racing-car', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Fire Engine', 'fire-engine', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Helicopter', 'helicopter', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Sailboat', 'sailboat', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Tractor', 'tractor', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('Steam Train', 'locomotive', (SELECT id FROM sticker_category WHERE name = 'Vehicles'), 'ACTIVE', FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO sticker_design (name, artwork_key, category_id, status, is_fallback, created_at, updated_at)
VALUES ('Gold Star', 'glowing-star', NULL, 'ACTIVE', TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
