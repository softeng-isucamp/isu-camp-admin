-- Phase 3, step 1 of 2: every Place must say what it is.
--
-- Run this BEFORE deploying the code that retires the legacy "Building"
-- classification. Afterwards ``building.type_id`` can no longer be NULL, so
-- the model stops needing a fallback for the Places that said nothing but
-- "Building", and ``place_classification`` is simply the type's name.
--
-- Step 2 (20261022_drop_place_classification.sql) drops the deprecated
-- ``classification`` column, and must run AFTER the deploy: the running code
-- still writes that column until then, and it is NOT NULL without a default.
--
-- Verified on 2026-10-20: all 57 Places carry a type_id, no outdoor Place
-- holds indoor Locations, and classification agrees with type_id on every
-- row. The guard below re-checks the first of those at apply time rather
-- than trusting that nothing has changed since.
--
-- Re-runnable: SET NOT NULL on a column that already has it is a no-op.

BEGIN;

DO $$
DECLARE
    untyped bigint;
BEGIN
    SELECT count(*) INTO untyped FROM public.building WHERE type_id IS NULL;
    IF untyped > 0 THEN
        RAISE EXCEPTION
            'Cannot retire the legacy classification: % Place(s) still have no type_id. Classify them in the admin portal first.',
            untyped;
    END IF;
END $$;

ALTER TABLE public.building
    ALTER COLUMN type_id SET NOT NULL;

COMMIT;

-- Afterwards:
--     select count(*) filter (where type_id is null) as untyped from public.building;
--     \d public.building
