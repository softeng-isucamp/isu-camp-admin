-- 2026-10-07  Let public.pathway accept a row without distance or ETA.
--
-- Adding a Pathway failed with a 500 "Could not create pathway", from
--
--     null value in column "distance_m" of relation "pathway"
--         violates not-null constraint
--
-- "Remove pathway distance and ETA metadata" (28231ba, 2026-10-04) stopped
-- mapping distance_m and estimated_minutes on the Pathway model and shipped
-- database/migrations/2026-10-04-drop-pathway-metrics.sql to drop them, but
-- that migration was never applied to the Supabase project. Both columns were
-- still not null with no default, so every insert into public.pathway failed:
-- POST /api/pathways, the Map Editor draft save, and the path-point conversion
-- that splits a pathway in two.
--
-- Dropping the not-null rather than the columns is the reversible half of that
-- migration. It unblocks a write immediately and keeps the 52 existing rows'
-- values, which matters because this schema has a second reader - the User App
-- (isu-camp-app) - whose queries are not visible from this repository. Apply
-- the drop once that app is known not to select either column; the comments
-- below say so on the columns themselves, so a reader of the schema does not
-- have to find this file.
--
-- Applied to the Supabase project on 2026-10-07 as migration
-- "relax_pathway_distance_and_eta_not_null". Safe to re-run: dropping a
-- not-null that is already dropped is a no-op.

alter table public.pathway
    alter column distance_m drop not null,
    alter column estimated_minutes drop not null;

comment on column public.pathway.distance_m is
    'Legacy pathway length in metres. No longer written: the admin stopped deriving length from path geometry on 2026-10-04 (see app/model/pathway.py). Null on every row created since. Pending removal by database/migrations/2026-10-04-drop-pathway-metrics.sql once no reader selects it.';

comment on column public.pathway.estimated_minutes is
    'Legacy pathway travel-time estimate in minutes. No longer written: the admin stopped deriving an ETA from path geometry on 2026-10-04 (see app/model/pathway.py). Null on every row created since. Pending removal by database/migrations/2026-10-04-drop-pathway-metrics.sql once no reader selects it.';
