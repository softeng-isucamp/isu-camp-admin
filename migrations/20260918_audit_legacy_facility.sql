-- Read-only predeployment audit for the legacy Facility location type.
-- Run this file in every target environment before applying the cleanup.

BEGIN READ ONLY;

SELECT type_id, type_name, description
FROM public.location_type
ORDER BY type_id;

SELECT type_id, COUNT(*) AS location_count
FROM public.location
GROUP BY type_id
ORDER BY type_id;

SELECT
  location_id,
  location_code,
  location_name,
  building_id,
  floor_id,
  keywords IS NOT NULL AS has_keywords,
  photo IS NOT NULL AS has_photo
FROM public.location
WHERE type_id = 4
ORDER BY location_id;

SELECT
  legacy.location_id,
  legacy.location_code,
  existing_id.building_id AS conflicting_building_id,
  existing_code.building_id AS conflicting_code_building_id
FROM public.location AS legacy
LEFT JOIN public.building AS existing_id
  ON existing_id.building_id = legacy.location_id
LEFT JOIN public.building AS existing_code
  ON lower(existing_code.building_code) = lower(legacy.location_code)
WHERE legacy.type_id = 4
ORDER BY legacy.location_id;

SELECT
  node.node_id,
  node.location_id,
  node.building_id
FROM public.route_node AS node
JOIN public.location AS legacy
  ON legacy.location_id = node.location_id
WHERE legacy.type_id = 4
ORDER BY node.node_id;

SELECT
  child_schema.nspname AS referencing_schema,
  child_table.relname AS referencing_table,
  child_column.attname AS referencing_column,
  constraint_row.conname AS constraint_name
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
ORDER BY referencing_schema, referencing_table, referencing_column;

ROLLBACK;
