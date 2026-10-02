-- 2026-09-25  Add latitude/longitude to public.location (indoor room markers).
--
-- The indoor marker feature (app/model/location.py latitude/longitude, the
-- PATCH /api/map/buildings/<id>/indoor-locations/<id> endpoint in
-- app/routes/map.py and the admin map editor) shipped without these columns:
-- 20260913153656_drop_location_lat_lng_photo_mime_type removed them, so every
-- read of a location and every marker save failed with UndefinedColumn.
--
-- Column type matches public.building.latitude/longitude -- numeric(9, 6),
-- roughly 11 cm of precision, which is finer than any room footprint needs.
--
-- Applied to the Supabase project on 2026-09-25 as migration
-- "add_location_latitude_longitude". Safe to re-run: every statement is guarded.

alter table public.location
    add column if not exists latitude  numeric(9, 6),
    add column if not exists longitude numeric(9, 6);

comment on column public.location.latitude is
    'Optional map marker position for an indoor location, independent of the containing building''s footprint anchor. Set together with longitude or left null.';
comment on column public.location.longitude is
    'Optional map marker position for an indoor location, independent of the containing building''s footprint anchor. Set together with latitude or left null.';

-- to_location_dto reports "positioned" only when both values are present, and
-- routes/map.py set_indoor_location_position writes them as a pair, so a row
-- carrying exactly one of the two would be a bug.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'location_position_pair_check'
          and conrelid = 'public.location'::regclass
    ) then
        alter table public.location
            add constraint location_position_pair_check
            check ((latitude is null) = (longitude is null));
    end if;
end $$;
