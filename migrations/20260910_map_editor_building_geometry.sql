-- Map Editor Building/Facility footprint persistence.
-- Apply this migration once to the existing Supabase/PostgreSQL database
-- before deploying the Building footprint endpoints.

BEGIN;

ALTER TABLE public.building
  ADD COLUMN IF NOT EXISTS classification VARCHAR(32);

UPDATE public.building
SET classification = 'Building'
WHERE classification IS NULL;

ALTER TABLE public.building
  ALTER COLUMN classification SET DEFAULT 'Building',
  ALTER COLUMN classification SET NOT NULL;

ALTER TABLE public.building
  ADD COLUMN IF NOT EXISTS polygon_coordinates JSON;

COMMIT;
