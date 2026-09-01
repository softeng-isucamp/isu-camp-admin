# Locations API contract research

## Findings

- The project specification defines a **Floor Level** as standardized metadata used to group indoor locations; it is not a separately managed Campus Location. See [CONTEXT.md](../CONTEXT.md) and [ADR 0001](adr/0001-model-floors-as-location-metadata.md).
- The project model defines a Campus Location as a managed place such as a building, room, office, laboratory, restroom, or standalone facility. A Building is a distinct location concept, while an indoor location belongs directly to a Building.
- The current SQLAlchemy model uses `location_id`, `building_id`, `floor_id`, `type_id`, `location_code`, and `location_name`, but the current frontend uses normalized fields such as `id`, `parentId`, `name`, `code`, `type`, and `floor`. This requires an API mapping boundary; it does not by itself require a database migration.
- OpenAPI is appropriate for documenting the stable request/response DTOs and known error responses. The specification models reusable schemas and operation responses; see the [OpenAPI Specification](https://spec.openapis.org/oas/).
- If spatial coordinates are returned or added to the locations contract, GeoJSON provides a standard representation and requires geographic coordinates in longitude/latitude order; see [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946.html).
- JSON Schema's `properties` and `required` keywords provide a useful basis for validating DTO shape and required fields; see the [JSON Schema object reference](https://json-schema.org/understanding-json-schema/reference/object).

## Recommendation for this slice

Use the backend API DTO—not the ORM model and not the current mock `Location` type—as the authoritative contract. Keep the existing database schema unless the backend team confirms a real domain mismatch. Add a thin frontend mapper and a small locations API surface around list, create, update, delete, and (only if owned by Locations) position operations.

## Verified HTTP contract

All Locations operations are administrator-authenticated and use the Flask
session cookie. The supported operations are:

- `GET /api/locations?q=&page=&pageSize=` returns `{ items, total, page,
  pageSize }`. Search is case-insensitive across name, code, type, Building,
  Floor Level, description, and keywords. An empty `items` array is a valid
  successful empty result.
- `POST /api/locations` and `PUT /api/locations/{id}` accept JSON for ordinary
  writes and multipart form data when a photo is included. They return one
  normalized Location DTO.
- `PATCH /api/locations/{id}/position` accepts a complete coordinate pair or
  two null values. Only standalone Outdoor Point Locations may own it.
- `DELETE /api/locations/{id}` returns `{ success: true, deleted: { id, count,
  ids } }`. Building deletion permanently includes its direct Indoor
  Locations in the same transaction.
- `GET /api/locations/{id}/photo` returns the stored image bytes only when
  MIME metadata is available; ordinary DTO responses expose `hasPhoto` only.

Errors use `{ success: false, message, fields?, relationships? }`. Authentication
failures are `401`, missing records are `404`, validation failures are `400`,
duplicate codes are `409`, and persistence/list failures are `500`.

The frontend real adapter treats a malformed response as an error and never
substitutes local or mock Location rows. The `local` adapter remains the
deterministic fixture mode; `mock` and `real` both use the HTTP interface.
The legacy schema has no persisted lifecycle-status column, so the backend
honestly projects `status: "Active"`; status edits are not claimed as durable
state. Indoor coordinates are likewise always null and positioning is owned by
the explicit Outdoor Point operation.
