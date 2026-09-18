-- Seed the location types referenced by the Admin App's location model.
-- The location table has a foreign key to this lookup table, so the seed is
-- required before creating supported indoor locations.
-- This migration is safe to run more than once.

BEGIN;

INSERT INTO public.location_type (type_id, type_name, description)
OVERRIDING SYSTEM VALUE
VALUES
  (1, 'Room', 'An indoor room within a Building'),
  (2, 'Laboratory', 'An indoor laboratory within a Building'),
  (3, 'Office', 'An indoor office within a Building'),
  (5, 'Restroom', 'An indoor restroom within a Building')
ON CONFLICT (type_id) DO UPDATE
SET type_name = EXCLUDED.type_name,
    description = EXCLUDED.description;

SELECT setval(
  pg_get_serial_sequence('public.location_type', 'type_id'),
  GREATEST((SELECT MAX(type_id) FROM public.location_type), 1),
  true
);

COMMIT;
