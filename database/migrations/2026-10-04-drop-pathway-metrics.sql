-- Remove pathway distance and estimated ETA metadata. Path geometry remains in
-- public.path_point and is no longer converted into length or travel time.
BEGIN;

ALTER TABLE public.pathway
    DROP COLUMN IF EXISTS distance_m,
    DROP COLUMN IF EXISTS estimated_minutes;

COMMIT;
