-- 2026-10-07  Add status to public.building (Building lifecycle status).
--
-- The admin Building form (frontend/admin/src/features/locations/
-- LocationDetailsModal.tsx) has always offered an Active/Inactive STATUS
-- choice, and the Locations directory filters on it, but public.building had
-- no column to keep it in: Building.to_location_dto reported a hard-coded
-- "Active" for every row and the chosen value was dropped on save. The field
-- was disabled in the form with the helper "Status is read-only until the
-- backend persists lifecycle status." -- this column is that backend.
--
-- Lowercase vocabulary with a check constraint, matching the two status
-- columns already in the schema (public.route_node.status and
-- public.pathway.status). The admin API normalizes to and from the directory's
-- title-case spelling on the way through, so the stored vocabulary stays this
-- one. Unlike public."userInfo".user_type there is no second writer to couple a
-- deploy to: the admin backend is the only thing that writes a Building.
--
-- Existing rows become active, which is what the DTO already claimed they
-- were, so nothing visible changes until an admin marks a building inactive.
--
-- Applied to the Supabase project on 2026-10-07 as migration
-- "add_building_status". Safe to re-run: every statement is guarded.

alter table public.building
    add column if not exists status varchar(20) not null default 'active';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'building_status_check'
          and conrelid = 'public.building'::regclass
    ) then
        alter table public.building
            add constraint building_status_check
            check (status in ('active', 'inactive'));
    end if;
end $$;

comment on column public.building.status is
    'Lifecycle status of the building: active or inactive. Mirrors the vocabulary of public.route_node.status and public.pathway.status; the admin API presents it as Active/Inactive. Rows that predate the column were defaulted to active.';
