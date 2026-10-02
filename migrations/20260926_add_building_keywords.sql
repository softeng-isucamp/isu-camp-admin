-- 2026-09-26  Add keywords to public.building (Building Search Keywords).
--
-- The admin Building form (frontend/admin/src/features/map/BuildingDetailsModal.tsx
-- and BuildingFootprintWorkflow.ts) sends "keywords" alongside name/code/function,
-- and public.location has carried a keywords column since the directory shipped.
-- public.building did not, so the value was dropped on save and the User App
-- campus catalog (GET /campus/buildings), which selects building.keywords,
-- failed with UndefinedColumn.
--
-- Nullable text, same shape as public.location.keywords. Existing rows read
-- back as null.
--
-- Applied to the Supabase project on 2026-09-27 as migration
-- "add_building_keywords". Safe to re-run: the statement is guarded.

alter table public.building
    add column if not exists keywords text;

comment on column public.building.keywords is
    'Optional free-text search keywords/tags for a building, mirroring public.location.keywords. Null when no keywords are set.';
