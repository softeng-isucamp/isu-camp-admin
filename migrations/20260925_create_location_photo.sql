-- 2026-09-25  Create public.location_photo (multi-photo gallery).
--
-- The gallery feature (app/model/location_photo.py, app/services/location_photos.py,
-- the /api/actions/locations/<id>/photos endpoints and the admin LocationPhotoUpload
-- component) shipped without this table, so every gallery read and every multi-photo
-- upload failed with UndefinedTable.
--
-- Applied to the Supabase project on 2026-09-25 as migration
-- "create_location_photo_gallery". Safe to re-run: every statement is guarded.

create table if not exists public.location_photo (
    photo_id   bigint       generated always as identity primary key,
    owner_type varchar(8)   not null,
    owner_id   bigint       not null,
    position   integer      not null,
    filename   varchar(255) not null,
    mime_type  varchar(32)  not null,
    content    bytea        not null,
    is_cover   boolean      not null default false,
    constraint location_photo_owner_type_check check (owner_type in ('building', 'location')),
    constraint location_photo_position_check check (position >= 0)
);

comment on table public.location_photo is
    'Gallery photos for a Building or indoor Location. owner_type selects which table owner_id points at; position is the 0-based display order and is_cover marks the photo mirrored into building.photo / location.photo.';

-- Matches services.location_photos.list_photos: filter by owner, order by position.
create index if not exists location_photo_owner_idx
    on public.location_photo (owner_type, owner_id, position);

-- Every other public table has RLS on with no policies; the Flask backend
-- connects with a privileged role and bypasses it.
alter table public.location_photo enable row level security;

-- Note: owner_id is polymorphic (building.building_id or location.location_id),
-- so it cannot carry a foreign key. Deletion is handled in application code --
-- routes/actions.py delete_location and routes/map.py delete_map_building.
