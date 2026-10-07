-- 2026-10-07  Add status to public.location (Indoor Location lifecycle status).
--
-- The companion to 20261007_add_building_status.sql. That migration gave
-- public.building the column behind the admin form's Active/Inactive STATUS
-- choice; public.location, which holds the Indoor Locations, still had none,
-- so Location.to_location_dto reported a hard-coded "Active" for every row and
-- the field stayed disabled for everything but a Building.
--
-- Same shape and vocabulary as public.building.status, so the directory can
-- filter both tables through one projected value. Existing rows become active,
-- which is what the DTO already claimed they were.
--
-- Applied to the Supabase project on 2026-10-07 as migration
-- "add_location_status". Safe to re-run: every statement is guarded.

alter table public.location
    add column if not exists status varchar(20) not null default 'active';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'location_status_check'
          and conrelid = 'public.location'::regclass
    ) then
        alter table public.location
            add constraint location_status_check
            check (status in ('active', 'inactive'));
    end if;
end $$;

comment on column public.location.status is
    'Lifecycle status of the indoor location: active or inactive. Mirrors public.building.status and the vocabulary of public.route_node.status and public.pathway.status; the admin API presents it as Active/Inactive. Rows that predate the column were defaulted to active.';
