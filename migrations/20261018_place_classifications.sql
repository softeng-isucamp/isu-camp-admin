-- Phase 1 of the Place classification rollout: make building.type_id the
-- source of truth for what a Place is.
--
-- public.building_type and public.building.type_id already exist and are
-- unused (see 20261017_add_building_type.sql). This wires them in: the four
-- Facilities are backfilled, the "can hold indoor Locations" rule moves into
-- the table, and the descriptions are aligned with the glossary in
-- CONTEXT.md.
--
-- type_id IS NULL means legacy - a Place that predates the vocabulary, read
-- as "Building". The 53 such rows are deliberately left alone: admins
-- reclassify them in the portal in Phase 2. Phase 3 makes the column NOT
-- NULL and drops classification.
--
-- Re-runnable: every statement is idempotent, and running this twice changes
-- nothing the first run did not already do.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Whether a type may hold indoor Locations, as data rather than code.
-- ---------------------------------------------------------------------------
-- Defaults to false so a type seeded later cannot silently accept Locations.

ALTER TABLE public.building_type
    ADD COLUMN IF NOT EXISTS can_contain_locations boolean NOT NULL DEFAULT false;

UPDATE public.building_type
SET can_contain_locations = true
WHERE type_name IN ('College', 'Campus Services');

UPDATE public.building_type
SET can_contain_locations = false
WHERE type_name IN ('Food', 'Parking', 'Facility');

-- ---------------------------------------------------------------------------
-- 2. Backfill the Places that are already correctly classified.
-- ---------------------------------------------------------------------------
-- The four Facilities say something real, so they carry over. The 53
-- 'Building' rows say nothing worth migrating and stay NULL.

UPDATE public.building
SET type_id = (SELECT type_id FROM public.building_type WHERE type_name = 'Facility')
WHERE classification = 'Facility'
  AND type_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Align the descriptions with the glossary.
-- ---------------------------------------------------------------------------
-- Campus Services omitted the infirmary and the library; Facility mentioned
-- comfort rooms, which are indoor Restroom Locations rather than Places.

UPDATE public.building_type SET description =
    'A Place whose primary occupant is an academic unit (a college, school, or institute) and which is used mainly for classes or research.'
WHERE type_name = 'College';

UPDATE public.building_type SET description =
    'Any Place that can contain indoor Locations and is not a College, such as administration offices, the infirmary, the library, or the student center.'
WHERE type_name = 'Campus Services';

UPDATE public.building_type SET description =
    'A standalone Place for eating, such as a canteen or food court.'
WHERE type_name = 'Food';

UPDATE public.building_type SET description =
    'An outdoor area for parking vehicles.'
WHERE type_name = 'Parking';

UPDATE public.building_type SET description =
    'Any other outdoor area or open structure that people go to for its own sake, such as an oval, grandstand, open gym, or open study area.'
WHERE type_name = 'Facility';

-- ---------------------------------------------------------------------------
-- 4. The indoor vocabulary's descriptions. Names and ids are unchanged.
-- ---------------------------------------------------------------------------

UPDATE public.location_type SET description =
    'An enclosed indoor space whose primary purpose is not covered by Office, Laboratory, or Restroom: classrooms, lounges, study rooms, meeting rooms.'
WHERE type_id = 1;

UPDATE public.location_type SET description =
    'An indoor Location with specialized equipment for classes or research, such as a computer lab or science lab.'
WHERE type_id = 2;

UPDATE public.location_type SET description =
    'An indoor Location where staff work and visitors come to transact or meet someone, such as the Registrar or a Dean''s Office.'
WHERE type_id = 3;

UPDATE public.location_type SET description =
    'An indoor Location with toilets.'
WHERE type_id = 5;

-- ---------------------------------------------------------------------------
-- 5. No new legacy Places.
-- ---------------------------------------------------------------------------
-- The server-side default meant a Place created without a classification
-- quietly became legacy. Creating one is now refused by the API, so the
-- default has nothing left to do.

ALTER TABLE public.building
    ALTER COLUMN classification DROP DEFAULT;

COMMIT;

-- Afterwards:
--     select type_name, can_contain_locations from public.building_type order by type_id;
--     select count(*) filter (where type_id is null) as legacy,
--            count(*) filter (where type_id is not null) as classified
--       from public.building;
