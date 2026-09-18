# Database migrations

The backend expects the SQLAlchemy models and the target PostgreSQL schema to
be deployed together. These SQL files are idempotent, but they are not applied
automatically by Flask.

Run every migration in the target database's SQL editor or migration runner
before starting the backend. For the Map Editor changes, apply them in this
order:

1. `20260913_seed_location_types.sql`
2. `20260910_audit_log.sql`
3. `20260910_map_editor_building_geometry.sql`
4. `20260910_map_editor_network_constraints.sql`
5. `20260913_backfill_building_anchors.sql`
6. `20260918_remove_legacy_facility_location_type.sql`

Before deploying the backend after the location model change, run
`20260918_audit_legacy_facility.sql` in every target environment and retain its
output with the release record. Apply the final Facility cleanup only after the
Building classification migration. It atomically converts legacy
`location.type_id = 4` rows into `building` rows with
`classification = 'Facility'`, preserves their IDs, remaps historical Route
Node references when possible, and removes lookup ID 4. The migration aborts
before writing if an existing Building identity, parent/floor relationship, or
unmapped foreign-key relationship could make the conversion lossy. Do not
delete the lookup row manually or disable the `location.type_id` foreign key.
Because Building has no parent or Floor relationship, such a legacy row cannot
be converted losslessly without a structural schema change; it must be resolved
before rerunning the migration.

Renumbering database IDs is explicitly out of scope. Room, Laboratory, Office,
and Restroom remain IDs 1, 2, 3, and 5 respectively.

The audit-log migration is required even for login: successful authentication
records a `System` audit entry before returning the login response.

The network-constraints migration intentionally fails if existing Path Points
contain duplicate sequence numbers within one Pathway; resolve those records
before retrying it.
