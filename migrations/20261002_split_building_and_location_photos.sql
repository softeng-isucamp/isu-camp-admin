-- 2026-10-02  Split the polymorphic gallery into public.building_photo and
--             public.location_photo, and drop the mirrored cover columns.
--
-- Before: one public.location_photo table addressed by (owner_type, owner_id),
-- which could not carry a foreign key, so every delete path had to purge its
-- rows by hand. The chosen cover was additionally copied into
-- building.photo / location.photo so the older /photo endpoint kept working,
-- leaving each cover image stored twice.
--
-- After: one table per owner, each with a real foreign key and ON DELETE
-- CASCADE, and is_cover as the single source of truth for the cover. The
-- /photo endpoint now reads the cover row, so the mirrored columns are gone.
--
-- Safe to re-run: every statement is guarded. Image content is preserved --
-- rows are moved, never recreated, and photo_id values are carried over.
--
-- RESTART THE BACKEND AS PART OF APPLYING THIS. Step 4 drops columns that the
-- pre-split models still select, so any Flask process started beforehand keeps
-- asking for building.photo_mime_type and fails every query touching a Building
-- or a Location -- the locations list, the map, and the dashboard all return 500
-- with: ERROR 42703: column "photo_mime_type" does not exist. debug=True does
-- not help, because the reloader only watches files, not the schema.

begin;

-- ---------------------------------------------------------------------------
-- 1. Buildings
-- ---------------------------------------------------------------------------
create table if not exists public.building_photo (
    photo_id    bigint       generated always as identity primary key,
    building_id bigint       not null references public.building (building_id) on delete cascade,
    position    integer      not null,
    filename    varchar(255) not null,
    mime_type   varchar(32)  not null,
    content     bytea        not null,
    is_cover    boolean      not null default false,
    constraint building_photo_position_check check (position >= 0)
);

comment on table public.building_photo is
    'Gallery photos for a Building. position is the 0-based display order; is_cover marks the one photo served by GET /api/actions/locations/<id>/photo?type=Building.';

-- Matches services.location_photos.list_photos: filter by owner, order by position.
create index if not exists building_photo_owner_idx
    on public.building_photo (building_id, position);

-- At most one cover per building, enforced by the database rather than only by
-- services.location_photos.apply_gallery.
create unique index if not exists building_photo_one_cover_idx
    on public.building_photo (building_id) where is_cover;

-- ---------------------------------------------------------------------------
-- 2. Indoor locations
-- ---------------------------------------------------------------------------
create table if not exists public.location_photo_split (
    photo_id    bigint       generated always as identity primary key,
    location_id bigint       not null references public.location (location_id) on delete cascade,
    position    integer      not null,
    filename    varchar(255) not null,
    mime_type   varchar(32)  not null,
    content     bytea        not null,
    is_cover    boolean      not null default false,
    constraint location_photo_position_check check (position >= 0)
);

comment on table public.location_photo_split is
    'Gallery photos for an indoor Location. position is the 0-based display order; is_cover marks the one photo served by GET /api/actions/locations/<id>/photo.';

-- ---------------------------------------------------------------------------
-- 3. Move the existing rows, keeping their photo_id values
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'location_photo'
          and column_name = 'owner_type'
    ) then
        insert into public.building_photo
            (photo_id, building_id, position, filename, mime_type, content, is_cover)
        overriding system value
        select photo_id, owner_id, position, filename, mime_type, content, is_cover
        from public.location_photo
        where owner_type = 'building'
        on conflict (photo_id) do nothing;

        insert into public.location_photo_split
            (photo_id, location_id, position, filename, mime_type, content, is_cover)
        overriding system value
        select photo_id, owner_id, position, filename, mime_type, content, is_cover
        from public.location_photo
        where owner_type = 'location'
        on conflict (photo_id) do nothing;

        drop table public.location_photo;
        alter table public.location_photo_split rename to location_photo;
        alter index location_photo_split_pkey rename to location_photo_pkey;
        alter table public.location_photo
            rename constraint location_photo_split_location_id_fkey
                to location_photo_location_id_fkey;
    end if;
end $$;

-- Named after the rename so the index exists under its final name either way.
create index if not exists location_photo_owner_idx
    on public.location_photo (location_id, position);

create unique index if not exists location_photo_one_cover_idx
    on public.location_photo (location_id) where is_cover;

-- Identity columns do not know about the ids inserted above.
select setval(
    pg_get_serial_sequence('public.building_photo', 'photo_id'),
    greatest(coalesce((select max(photo_id) from public.building_photo), 0), 1)
);
select setval(
    pg_get_serial_sequence('public.location_photo', 'photo_id'),
    greatest(coalesce((select max(photo_id) from public.location_photo), 0), 1)
);

-- ---------------------------------------------------------------------------
-- 4. Drop the mirrored cover columns
-- ---------------------------------------------------------------------------
-- Every non-null value was a byte-for-byte copy of that owner's is_cover row,
-- so the images survive in the tables above.
alter table public.building drop column if exists photo;
alter table public.building drop column if exists photo_mime_type;
alter table public.location drop column if exists photo;
alter table public.location drop column if exists photo_mime_type;

-- Every other public table has RLS on with no policies; the Flask backend
-- connects with a privileged role and bypasses it.
alter table public.building_photo enable row level security;
alter table public.location_photo enable row level security;

commit;
