-- Convert legacy public.location rows with type_id=4 into classified
-- public.building rows, then remove the obsolete lookup value.
--
-- This migration deliberately aborts before writing when identity or
-- relationship preservation is ambiguous.  Run it in one transaction and
-- verify the preflight failure rather than bypassing the foreign key.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.location_type
    WHERE type_id = 4
      AND type_name <> 'Facility'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove location type 4 because it is not the legacy Facility value';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.location AS legacy
    JOIN public.building AS existing
      ON existing.building_id = legacy.location_id
    WHERE legacy.type_id = 4
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility locations: a building already uses the location identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.location AS legacy
    JOIN public.building AS existing
      ON lower(existing.building_code) = lower(legacy.location_code)
    WHERE legacy.type_id = 4
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility locations: a building already uses the location code';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.location
    WHERE type_id = 4
      AND (building_id IS NOT NULL OR floor_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility locations with parent or floor relationships';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.location
    WHERE type_id = 4
      AND (keywords IS NOT NULL OR photo IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility locations with fields not supported by Building';
  END IF;

  -- The current schema has one historical Route Node reference to Location.
  -- Any other FK would be a relationship this migration cannot safely map.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child_table
      ON child_table.oid = constraint_row.conrelid
    JOIN pg_namespace AS child_schema
      ON child_schema.oid = child_table.relnamespace
    JOIN pg_attribute AS child_column
      ON child_column.attrelid = child_table.oid
     AND child_column.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.location'::regclass
      AND NOT (
        child_schema.nspname = 'public'
        AND child_table.relname = 'route_node'
        AND child_column.attname = 'location_id'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility locations: an unmapped foreign-key relationship exists';
  END IF;

  IF to_regclass('public.route_node') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'route_node'
         AND column_name = 'location_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'route_node'
         AND column_name = 'building_id'
     )
     AND EXISTS (
       SELECT 1
       FROM public.route_node AS node
       JOIN public.location AS legacy
         ON legacy.location_id = node.location_id
       WHERE legacy.type_id = 4
     ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility Route Node references without building_id';
  END IF;

  IF to_regclass('public.route_node') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.route_node AS node
       JOIN public.location AS legacy
         ON legacy.location_id = node.location_id
       WHERE legacy.type_id = 4
         AND node.building_id IS NOT NULL
         AND node.building_id <> legacy.location_id
     ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy Facility Route Node references with conflicting building identity';
  END IF;
END $$;

INSERT INTO public.building (
  building_id,
  building_code,
  building_name,
  classification,
  description,
  created_at,
  updated_at
)
OVERRIDING SYSTEM VALUE
SELECT
  location_id,
  location_code,
  location_name,
  'Facility',
  description,
  created_at,
  updated_at
FROM public.location
WHERE type_id = 4;

SELECT setval(
  pg_get_serial_sequence('public.building', 'building_id'),
  GREATEST((SELECT MAX(building_id) FROM public.building), 1),
  true
);

-- Preserve the historical Route Node association as a Building association.
DO $$
BEGIN
  IF to_regclass('public.route_node') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'route_node'
         AND column_name = 'location_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'route_node'
         AND column_name = 'building_id'
     ) THEN
    UPDATE public.route_node AS node
    SET building_id = node.location_id,
        location_id = NULL
    FROM public.location AS legacy
    WHERE legacy.location_id = node.location_id
      AND legacy.type_id = 4;
  END IF;
END $$;

DELETE FROM public.location
WHERE type_id = 4;

DELETE FROM public.location_type
WHERE type_id = 4;

COMMIT;
