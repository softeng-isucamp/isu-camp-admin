-- Merge Ground Floor and 1st Floor into one storey, kept as floor_number 1.
--
-- The Locations form offered both, and they named the same place. The term
-- that survives is "Ground Floor"; the number it is stored as is 1, so the
-- directory counts storeys from 1 and the label no longer disagrees with it.
--
-- No location is deleted and none loses its floor. Two floor rows are
-- removed, and only because they are duplicates created by the merge: see
-- step 1.
--
-- Safe to run more than once. Running it before deploying the application
-- change is also safe - services/floor_lookup.py reads 0 and 1 alike as the
-- Ground Floor, so the portal is correct on either side of this.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Buildings that hold both a Ground Floor (0) and a 1st Floor (1).
-- ---------------------------------------------------------------------------
-- Two rows that are about to become the same storey cannot both survive:
-- public.floor carries UNIQUE (building_id, floor_number), so renumbering the
-- 0 row to 1 would collide with the 1 row already there.
--
-- The locations move onto the surviving row first, then the emptied row goes.
-- At the time of writing this affects exactly two buildings - College of
-- Computing Studies ICT, and New Admin Building - and in both the 1st Floor
-- row is empty while the Ground Floor row carries every location, so this
-- moves 11 locations and deletes 2 rows that nothing references.
--
-- Verify before running:
--     select f.building_id, b.building_name, f.floor_number, f.floor_id,
--            (select count(*) from public.location l where l.floor_id = f.floor_id)
--     from public.floor f join public.building b using (building_id)
--     where f.building_id in (
--       select building_id from public.floor where floor_number in (0, 1)
--       group by building_id having count(distinct floor_number) > 1)
--     order by b.building_name, f.floor_number;

UPDATE public.location AS l
SET floor_id = keep.floor_id
FROM public.floor AS merged
JOIN public.floor AS keep
  ON keep.building_id = merged.building_id
 AND keep.floor_number = 1
WHERE merged.floor_number = 0
  AND l.floor_id = merged.floor_id;

DELETE FROM public.floor AS merged
USING public.floor AS keep
WHERE merged.floor_number = 0
  AND keep.building_id = merged.building_id
  AND keep.floor_number = 1;

-- ---------------------------------------------------------------------------
-- 2. Every remaining Ground Floor becomes floor 1.
-- ---------------------------------------------------------------------------
-- These buildings have no 1st Floor row, so the number changes in place and
-- the locations standing on it are untouched - they keep the same floor_id.

UPDATE public.floor
SET floor_number = 1
WHERE floor_number = 0;

-- ---------------------------------------------------------------------------
-- 3. Refuse to commit if anything was left behind.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    remaining integer;
    orphaned integer;
BEGIN
    SELECT count(*) INTO remaining FROM public.floor WHERE floor_number = 0;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'floor_number 0 still present on % row(s)', remaining;
    END IF;

    SELECT count(*) INTO orphaned
    FROM public.location l
    WHERE l.floor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.floor f WHERE f.floor_id = l.floor_id);
    IF orphaned > 0 THEN
        RAISE EXCEPTION '% location(s) point at a floor that no longer exists', orphaned;
    END IF;
END $$;

COMMIT;

-- Afterwards, every indoor location should still have a floor, and the
-- lowest floor in the directory should be 1 (or -1 where a basement exists):
--     select floor_number, count(*) from public.floor group by 1 order by 1;
--     select count(*) from public.location where floor_id is null;
