# Location API compatibility with the legacy schema

The authenticated Locations read API exposes the normalized `Location` DTO
(`id`, `name`, `code`, `type`, `parentId`, `building`, `floor`, `function`,
`keywords`, `status`, `lat`, `lng`, and `positioned`). It does not expose ORM
column names to the frontend.

The current `public.location` table now stores coordinates through the committed
coordinate migration. Status remains a compatibility projection because the
legacy schema has no persisted status column. Coordinates for standalone
Outdoor Point Locations are edited only through the narrow authenticated
`PATCH /api/locations/<id>/position` operation; ordinary create/update writes
are orchestrated through that operation by the frontend adapter.

`building_id` is resolved against the persisted `public.building` table and
`floor_id` is resolved against `public.floor` for display context. Buildings
are composed into the directory from `public.building`; `public.location`
contains only the types represented by `public.location_type`. Floor rows
remain readable compatibility data; new floor grouping behavior follows ADR
0001.
