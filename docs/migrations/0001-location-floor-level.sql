-- Apply before enabling Location writes in a deployed backend.
-- Floor Levels are metadata (ADR 0001); legacy floor_id remains readable.
ALTER TABLE public.location ALTER COLUMN building_id DROP NOT NULL;
ALTER TABLE public.location ALTER COLUMN floor_id DROP NOT NULL;
ALTER TABLE public.location ADD COLUMN IF NOT EXISTS floor_level text;
CREATE UNIQUE INDEX IF NOT EXISTS location_code_case_insensitive_unique
  ON public.location (lower(location_code));
