-- Phase 3, step 2 of 2: drop the deprecated public.building.classification.
--
-- Run this AFTER deploying the code that retires the legacy "Building"
-- classification. Until that deploy the routes still write the column, and
-- it is NOT NULL without a default, so dropping it early breaks every Place
-- create and update.
--
-- ``building_type.type_name`` has been the source of truth since
-- 20261018_place_classifications.sql; classification has only been kept in
-- sync with it. Nothing reads it any more: the API's "type" field, the
-- Dashboard's analytics keys and the map's object kinds all come from the
-- type row.
--
-- This is not reversible. The values are recoverable only from a backup, and
-- they carry no information the type does not: 'Facility' maps to the
-- Facility type, and 'Building' said nothing at all.
--
-- Re-runnable: IF EXISTS makes a second run a no-op.

BEGIN;

ALTER TABLE public.building
    DROP COLUMN IF EXISTS classification;

COMMIT;

-- Afterwards:
--     \d public.building
--     select b.building_name, t.type_name
--       from public.building b join public.building_type t using (type_id)
--      order by b.building_id;
