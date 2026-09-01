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

`building_id` and `floor_id` are resolved against persisted location rows for
display context. Floor rows remain readable compatibility data; new floor
grouping behavior follows ADR 0001.
