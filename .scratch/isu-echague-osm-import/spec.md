# ISU Echague OpenStreetMap Development Import

Status: ready-for-agent
Label: ready-for-agent

## Problem Statement

ISU-CAMP currently uses hand-authored development data for campus locations, buildings, route nodes, and pathways. That data does not reliably represent the existing places and outdoor geometry around ISU Echague. The map editor needs a realistic, reproducible dataset so its location, route, boundary, and geometry workflows can be tested against the campus that users will actually navigate.

OpenStreetMap has useful coverage in the ISU Echague area, but a bounded query also returns surrounding-town objects, unnamed footprints, uncertain access information, and sparse pedestrian paths. The project needs a deterministic development import that gathers relevant OSM data, keeps its provenance, normalizes it into the existing application contracts, and produces a replacement mock fixture without pretending that imported data is official or complete.

## Solution

Build a development-only, deterministic importer that reads a bounded Overpass response and generates a reviewable ISU-CAMP fixture.

The importer will:

- use the existing ISU Echague boundary as the temporary clipping/review boundary, while allowing a confirmed OSM campus boundary to become the preferred boundary source;
- retrieve only relevant OSM tag families for named places, buildings, amenities, roads, pedestrian ways, entrances, barriers, and parking;
- preserve each raw OSM element and its provenance;
- classify OSM elements into import candidates;
- normalize the supported candidates into the existing buildings, locations, route nodes, and pathways data shape;
- generate deterministic application IDs that remain distinct from OSM IDs;
- flag uncertain, disconnected, outside-boundary, or incomplete geometry for review;
- generate a replacement development fixture that can be compared with and roll back to the existing mock fixture;
- make the generated fixture consumable by the current map editor and its validation behavior.

The first version is a one-time development import. It will not synchronize with OSM, update production data, or add a live import control to the admin panel.

## User Stories

1. As a developer, I want to run a reproducible bounded OSM import, so that the development map uses real ISU Echague data.
2. As a developer, I want the exact Overpass query and access date recorded, so that the fixture can be regenerated and audited.
3. As a developer, I want the raw OSM response retained with the fixture, so that normalized records can be traced back to their source geometry.
4. As a developer, I want each imported record to retain its provider, element type, element ID, canonical URL, tags, version, timestamp, and changeset when available, so that source provenance is not lost.
5. As a developer, I want deterministic generated IDs, so that repeated generation produces stable references and useful diffs.
6. As an administrator, I want named campus buildings from OSM represented as location and/or building candidates, so that I can review them in the existing map editor.
7. As an administrator, I want unnamed building footprints retained as review candidates, so that useful geometry is not discarded merely because OSM has no name.
8. As an administrator, I want amenities such as libraries, clinics, cafés, restaurants, schools, parking, and university areas represented as location candidates, so that existing campus places can be discovered.
9. As an administrator, I want OSM names, official names, short names, and references preserved separately, so that source labels are not confused with official ISU naming.
10. As an administrator, I want entrances and barriers represented as candidates or route nodes, so that gates and access constraints can be reviewed rather than invented.
11. As an administrator, I want explicit pedestrian ways such as footways, paths, pedestrian ways, steps, and tracks represented as walking-network candidates, so that the route editor starts from real geometry.
12. As an administrator, I want motor roads treated conservatively, so that service or residential roads are not automatically declared safe pedestrian routes.
13. As an administrator, I want pathway candidates to preserve surface, width, lighting, access, wheelchair, incline, and smoothness tags, so that route review has the relevant evidence.
14. As an administrator, I want campus-boundary checks applied to complete geometry, so that surrounding-town features are not silently imported as campus data.
15. As an administrator, I want boundary-crossing or uncertain objects flagged instead of silently discarded, so that I can decide whether they belong in the campus map.
16. As an administrator, I want disconnected paths and suspiciously long geometry jumps flagged, so that the walking network is not presented as complete when it is not.
17. As an administrator, I want route-node candidates connected to their source ways, so that route corrections can be traced to imported geometry.
18. As an administrator, I want the generated fixture to use the existing location, building, route-node, and pathway contracts, so that the current map editor can load it without a parallel data model.
19. As a developer, I want conservative defaults for fields that OSM does not provide, so that the importer does not invent rooms, floors, official codes, accessibility, gate availability, or routes.
20. As a developer, I want application IDs kept distinct from OSM IDs, so that source identity and application identity remain independently changeable.
21. As a developer, I want the previous mock fixture retained during the first import, so that I can compare behavior and roll back safely.
22. As a developer, I want the generated dataset separated into raw source, import candidates, normalized locations/buildings, and normalized route data, so that review information is not flattened into irreversible fields.
23. As a map user, I want the generated locations and paths to appear on the existing map, so that the development experience reflects actual ISU surroundings.
24. As a map user, I want the map editor's existing geometry validation to reject invalid or outside-boundary new geometry, so that imported data does not weaken existing safeguards.
25. As a maintainer, I want visible OpenStreetMap attribution wherever OSM data or OSM tiles are shown, so that the application respects the source requirements.
26. As a maintainer, I want the fixture documentation to identify the ODbL source and attribution, so that future developers understand the reuse obligations.
27. As a project owner, I want official ISU material to remain a future source for validating names and internal places, so that OSM labels are not treated as the final institutional authority.
28. As a project owner, I want synchronization, scheduled refreshes, and production replacement excluded from this first version, so that development validation is completed before operational policy is chosen.

## Implementation Decisions

- The highest seam is a deterministic transformation from a bounded Overpass response to a generated fixture. The current map editor remains the consumer of the fixture.
- Use Overpass for this read-only, one-time development extraction rather than the OSM editing API.
- Prefer a confirmed OSM campus boundary when one is identified. Until then, use the existing ISU Echague polygon as the retrieval/review boundary and fallback.
- Use a small bounded query and request only the required tag families. Retrieve complete geometry and metadata sufficient for provenance and validation.
- Relevant source families are named objects, `building=*`, campus-related `amenity=*`, pedestrian and contextual `highway=*`, `entrance=*`, `barrier=*`, `parking=*`, and selected named `place=*`, `leisure=*`, `sport=*`, and `landuse=*` objects.
- Treat every fetched element as an import candidate until it passes boundary and normalization checks. The bounding box alone does not establish campus membership.
- Preserve a raw source record for each OSM element, including provider, source type, source ID, canonical URL, complete tags, version, timestamp/changeset when available, original geometry, import run metadata, query, and boundary version.
- Generate deterministic fixture IDs with a fixture namespace/prefix and source type/ID. Never use an OSM ID as the sole application ID.
- Normalize closed building ways/relations into building footprints and optionally associated location candidates.
- Normalize named amenities and named areas into location candidates. Map only to existing application location types where the mapping is defensible; retain the original OSM classification separately.
- Normalize explicit pedestrian ways into pathway candidates and route-node candidates. Retain source-way/source-node references.
- Treat service, residential, and unclassified roads as context or review candidates, not automatically walkable pathways.
- Do not infer rooms, floors, official ISU codes, official names, accessibility, gate availability, ownership, or safe pedestrian access.
- Use nullable or conservative application fields where OSM does not provide a trustworthy value. Generated records must satisfy the current application schemas.
- Flag unnamed footprints, boundary crossings, incomplete or invalid geometry, isolated paths, suspicious jumps, uncertain access, and missing endpoints for review.
- Keep the generated fixture separate from the current mock fixture during the first implementation. Replacing the active development source is the intended end state after comparison and validation.
- Do not add synchronization, scheduled imports, production database writes, or a live admin import UI in this spec.
- Keep visible OpenStreetMap attribution in the map layer and fixture documentation. Do not bulk-download or prefetch OSM tiles.

## Testing Decisions

Tests should verify externally observable importer and fixture behavior rather than implementation details such as helper function structure.

- Test the importer with representative raw OSM nodes, ways, and relations, including named buildings, unnamed footprints, amenities, pedestrian ways, barriers, parking, duplicate query results, and objects outside or crossing the boundary.
- Test deterministic generation: the same raw response and boundary produce the same IDs and normalized output.
- Test provenance preservation: source identity, tags, canonical URL, metadata, geometry, query, boundary version, and import run information survive normalization.
- Test tag classification and conservative mapping into the existing `Building`, `Location`, `RouteNode`, and `Pathway` contracts.
- Test that unsupported or uncertain classifications remain candidates and are not converted into invented official data.
- Test coordinate validity, closed building polygons, non-empty required application fields, distinct IDs, and preservation of nullable fields.
- Test boundary behavior for points, polygons, and lines: outside objects are rejected or flagged; crossing geometries are explicitly reported; valid in-boundary geometry remains importable.
- Test walking-network quality checks for invalid path points, missing endpoints, self-connections, disconnected candidates, and suspiciously long segments.
- Test duplicate source elements are represented once by source identity.
- Test the generated fixture against the existing schema validation and map-draft review behavior.
- Test that the current map editor can load the generated fixture and retain its existing safeguards for placement, movement, pathway editing, and building geometry.
- Test fixture comparison/rollback behavior without requiring network access during normal unit tests; use a checked-in or recorded raw response for deterministic test input.
- Add an integration or command-level test that runs generation from a recorded Overpass response and verifies the expected fixture structure.
- Follow existing Vitest patterns used by `mapEditing`, `campusBoundary`, API, and feature tests. Add Playwright coverage only for externally visible map-editor behavior that cannot be proven at the importer seam.

## Out of Scope

- Automatic or scheduled OSM synchronization.
- Production database replacement or writes.
- A live admin-panel import button or import review queue UI.
- Indoor navigation, floor plans, rooms, stairwell models, or building-level routing.
- Treating OSM as the official authority for ISU building names or internal places.
- Inferring missing places, names, accessibility, ownership, gate availability, or pedestrian safety from satellite imagery or unrelated providers.
- Copying geometry from Google Maps or other sources without explicit permission.
- Building a complete authoritative walking network from sparse OSM path coverage.
- Offline map tiles, tile archives, bulk tile downloads, or tile prefetching.
- Replacing the existing Leaflet rendering stack with MapLibre or another map renderer.

## Further Notes

The research report records an observed bounded query result of 445 OSM elements on 2026-08-24, including named campus buildings and amenities, many additional footprints, surrounding roads, and sparse explicit pedestrian paths. This count is an observation, not a contract; the importer must remain tolerant of future OSM changes.

The research report is the primary source for the proposed Overpass query, observed coverage, tag mapping, quality risks, and licensing references: `docs/research/isu-echague-osm-map-data.md`.

The source and provenance model follows the terms in `CONTEXT.md` and the source decision in `docs/adr/0001-openstreetmap-as-development-map-source.md`.
