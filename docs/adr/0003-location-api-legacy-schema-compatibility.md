# Location API compatibility with the legacy schema

The authenticated Locations read API exposes the normalized `Location` DTO
(`id`, `name`, `code`, `type`, `parentId`, `building`, `floor`, `function`,
`keywords`, `status`, `lat`, `lng`, and `positioned`). It does not expose ORM
column names to the frontend.

The current `public.location` table has no persisted status or coordinate
columns. Until a deliberate migration establishes ownership for those values,
the API explicitly returns `status: "Active"`, `lat: null`, `lng: null`, and
`positioned: false`. These are compatibility projections, not discarded input.
Coordinates therefore cannot be edited through this read contract.

`building_id` and `floor_id` are resolved against persisted location rows for
display context. Floor rows remain readable compatibility data; new floor
grouping behavior follows ADR 0001.
