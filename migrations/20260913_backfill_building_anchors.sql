-- Backfill Building latitude/longitude with a representative point derived
-- from the authoritative footprint. The area centroid is used when it lies
-- inside the polygon; concave footprints fall back to the interior point with
-- the greatest approximate edge clearance on a 33 x 33 grid.

BEGIN;

CREATE FUNCTION pg_temp.point_in_polygon(
  candidate_latitude double precision,
  candidate_longitude double precision,
  points jsonb,
  ring_count integer
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  inside boolean := false;
  index integer;
  previous_index integer := ring_count - 1;
  latitude double precision;
  longitude double precision;
  previous_latitude double precision;
  previous_longitude double precision;
BEGIN
  FOR index IN 0..ring_count - 1 LOOP
    latitude := (points -> index ->> 0)::double precision;
    longitude := (points -> index ->> 1)::double precision;
    previous_latitude := (points -> previous_index ->> 0)::double precision;
    previous_longitude := (points -> previous_index ->> 1)::double precision;
    IF (longitude > candidate_longitude) <> (previous_longitude > candidate_longitude)
      AND candidate_latitude < (
        (previous_latitude - latitude) * (candidate_longitude - longitude)
        / (previous_longitude - longitude) + latitude
      )
    THEN
      inside := NOT inside;
    END IF;
    previous_index := index;
  END LOOP;
  RETURN inside;
END;
$$;

CREATE FUNCTION pg_temp.feature_anchor(points jsonb)
RETURNS double precision[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  point_count integer := jsonb_array_length(points);
  ring_count integer;
  index integer;
  next_index integer;
  row_index integer;
  column_index integer;
  origin_latitude double precision;
  origin_longitude double precision;
  latitude double precision;
  longitude double precision;
  next_latitude double precision;
  next_longitude double precision;
  twice_area double precision := 0;
  weighted_latitude double precision := 0;
  weighted_longitude double precision := 0;
  cross_product double precision;
  area_latitude double precision;
  area_longitude double precision;
  south double precision;
  north double precision;
  west double precision;
  east double precision;
  candidate_latitude double precision;
  candidate_longitude double precision;
  latitude_delta double precision;
  longitude_delta double precision;
  length_squared double precision;
  projection double precision;
  distance double precision;
  clearance double precision;
  best_clearance double precision := -1;
  best_latitude double precision;
  best_longitude double precision;
BEGIN
  IF point_count < 3 THEN
    RETURN NULL;
  END IF;

  ring_count := point_count;
  IF (points -> 0) = (points -> (point_count - 1)) THEN
    ring_count := ring_count - 1;
  END IF;
  IF ring_count < 3 THEN
    RETURN NULL;
  END IF;

  origin_latitude := (points -> 0 ->> 0)::double precision;
  origin_longitude := (points -> 0 ->> 1)::double precision;
  south := origin_latitude;
  north := origin_latitude;
  west := origin_longitude;
  east := origin_longitude;

  FOR index IN 0..ring_count - 1 LOOP
    next_index := (index + 1) % ring_count;
    latitude := (points -> index ->> 0)::double precision - origin_latitude;
    longitude := (points -> index ->> 1)::double precision - origin_longitude;
    next_latitude := (points -> next_index ->> 0)::double precision - origin_latitude;
    next_longitude := (points -> next_index ->> 1)::double precision - origin_longitude;
    cross_product := latitude * next_longitude - next_latitude * longitude;
    twice_area := twice_area + cross_product;
    weighted_latitude := weighted_latitude + (latitude + next_latitude) * cross_product;
    weighted_longitude := weighted_longitude + (longitude + next_longitude) * cross_product;

    latitude := latitude + origin_latitude;
    longitude := longitude + origin_longitude;
    south := LEAST(south, latitude);
    north := GREATEST(north, latitude);
    west := LEAST(west, longitude);
    east := GREATEST(east, longitude);
  END LOOP;

  IF abs(twice_area) < 1e-12 THEN
    RETURN NULL;
  END IF;

  area_latitude := origin_latitude + weighted_latitude / (3 * twice_area);
  area_longitude := origin_longitude + weighted_longitude / (3 * twice_area);
  IF pg_temp.point_in_polygon(area_latitude, area_longitude, points, ring_count) THEN
    RETURN ARRAY[area_latitude, area_longitude];
  END IF;

  FOR row_index IN 0..32 LOOP
    FOR column_index IN 0..32 LOOP
      candidate_latitude := south + (north - south) * row_index / 32;
      candidate_longitude := west + (east - west) * column_index / 32;
      IF NOT pg_temp.point_in_polygon(candidate_latitude, candidate_longitude, points, ring_count) THEN
        CONTINUE;
      END IF;

      clearance := NULL;
      FOR index IN 0..ring_count - 1 LOOP
        next_index := (index + 1) % ring_count;
        latitude := (points -> index ->> 0)::double precision;
        longitude := (points -> index ->> 1)::double precision;
        next_latitude := (points -> next_index ->> 0)::double precision;
        next_longitude := (points -> next_index ->> 1)::double precision;
        latitude_delta := next_latitude - latitude;
        longitude_delta := next_longitude - longitude;
        length_squared := latitude_delta * latitude_delta + longitude_delta * longitude_delta;
        projection := CASE WHEN length_squared = 0 THEN 0 ELSE LEAST(1, GREATEST(
          0,
          ((candidate_latitude - latitude) * latitude_delta
            + (candidate_longitude - longitude) * longitude_delta) / length_squared
        )) END;
        distance := sqrt(
          power(candidate_latitude - (latitude + projection * latitude_delta), 2)
          + power(candidate_longitude - (longitude + projection * longitude_delta), 2)
        );
        clearance := CASE WHEN clearance IS NULL THEN distance ELSE LEAST(clearance, distance) END;
      END LOOP;

      IF clearance > best_clearance THEN
        best_clearance := clearance;
        best_latitude := candidate_latitude;
        best_longitude := candidate_longitude;
      END IF;
    END LOOP;
  END LOOP;

  IF best_latitude IS NULL THEN
    RETURN ARRAY[origin_latitude, origin_longitude];
  END IF;
  RETURN ARRAY[best_latitude, best_longitude];
END;
$$;

WITH anchors AS MATERIALIZED (
  SELECT
    source.building_id,
    pg_temp.feature_anchor(source.polygon_coordinates::jsonb) AS anchor
  FROM public.building AS source
  WHERE source.polygon_coordinates IS NOT NULL
    AND jsonb_typeof(source.polygon_coordinates::jsonb) = 'array'
    AND jsonb_array_length(source.polygon_coordinates::jsonb) >= 3
)
UPDATE public.building AS building
SET
  latitude = anchors.anchor[1],
  longitude = anchors.anchor[2]
FROM anchors
WHERE building.building_id = anchors.building_id
  AND anchors.anchor IS NOT NULL
  AND (
    building.latitude IS DISTINCT FROM anchors.anchor[1]
    OR building.longitude IS DISTINCT FROM anchors.anchor[2]
  );

DROP FUNCTION pg_temp.feature_anchor(jsonb);
DROP FUNCTION pg_temp.point_in_polygon(double precision, double precision, jsonb, integer);

COMMIT;
