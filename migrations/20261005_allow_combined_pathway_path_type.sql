-- A Pathway can be both a Road and a Walkway (a road with a sidewalk), so
-- path_type stores the selected Way types joined in a canonical order. Pin the
-- vocabulary in the database so no other writer can invent a spelling.
alter table public.pathway
  drop constraint if exists pathway_path_type_check;

alter table public.pathway
  add constraint pathway_path_type_check
  check (path_type in ('Walkway', 'Road', 'Walkway, Road'));
