-- Apply after 0001-location-floor-level.sql.
-- Only standalone Facility Locations may use these nullable coordinates;
-- Indoor Locations remain hierarchy records and are rejected by the API.
ALTER TABLE public.location ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.location ADD COLUMN IF NOT EXISTS lng double precision;
