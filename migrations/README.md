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

The audit-log migration is required even for login: successful authentication
records a `System` audit entry before returning the login response.

The network-constraints migration intentionally fails if existing Path Points
contain duplicate sequence numbers within one Pathway; resolve those records
before retrying it.
