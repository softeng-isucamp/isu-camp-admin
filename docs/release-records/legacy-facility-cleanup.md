# Legacy Facility cleanup audit

Audit date: 2026-09-18

## Environment inventory

The repository and GitHub project exposed one configured Supabase database and
no named GitHub deployment environments or additional database-secret names.
The configured database was audited read-only. Any separately managed target
must run `migrations/20260918_audit_legacy_facility.sql` before deployment.

## Configured database result

- `public.location_type` contained IDs 1–5 with Facility at ID 4.
- `public.location` contained three Rooms and two Laboratories.
- No `public.location` row used legacy Facility type ID 4.
- `public.building` contained 38 Building-classified rows and no Facility rows.
- `location.type_id` referenced `location_type.type_id` with `ON DELETE RESTRICT`.
- The historical `route_node.location_id` reference used `ON DELETE SET NULL`;
  the cleanup migration remaps that association to `route_node.building_id`
  before deleting a migrated source row.

## Verification

The seed and cleanup migration were executed against an isolated PostgreSQL
schema using a synthetic legacy Facility and Route Node association. The check
verified identity, code, name, classification, description, timestamps, Route
Node association, lookup IDs, and Building sequence state. The transaction was
rolled back, and a follow-up query confirmed no temporary schema or live row
change remained.

The migration intentionally aborts rather than discard unsupported keywords,
photos, parent/Floor relationships, conflicting IDs/codes, or unknown foreign
keys. Building does not model its own parent or Floor; resolving such a row
without data loss would require a separately approved structural schema change.
