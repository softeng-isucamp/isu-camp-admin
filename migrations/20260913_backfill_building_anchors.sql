-- Backfill Building latitude/longitude from persisted footprint vertices.
-- Apply once to existing PostgreSQL databases after the building geometry
-- migration. Polygon coordinates remain the geometry source of truth; these
-- columns store the same derived map marker used by the editor.

BEGIN;

UPDATE public.building AS building
SET
  latitude = anchors.latitude,
  longitude = anchors.longitude
FROM (
  SELECT
    source.building_id,
    AVG((vertex.point ->> 0)::numeric) AS latitude,
    AVG((vertex.point ->> 1)::numeric) AS longitude
  FROM public.building AS source
  CROSS JOIN LATERAL jsonb_array_elements(source.polygon_coordinates::jsonb) AS vertex(point)
  WHERE source.polygon_coordinates IS NOT NULL
    AND jsonb_typeof(source.polygon_coordinates::jsonb) = 'array'
  GROUP BY source.building_id
) AS anchors
WHERE building.building_id = anchors.building_id
  AND (building.latitude IS NULL OR building.longitude IS NULL);

COMMIT;
