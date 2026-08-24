# ADR-0001: Use OpenStreetMap as the development map-data source

## Status

Accepted

## Decision

Use OpenStreetMap as the geographic source for the development import. Use official ISU information later to improve campus-specific names and internal places when that data is available.

The importer will select relevant OSM categories, preserve source IDs and tags, and normalize candidates into the application’s locations, buildings, route nodes, and pathways. The generated dataset will replace the current development mock data. OSM paths will seed editable walking-network candidates rather than being treated as a complete authoritative navigation graph.

The existing ISU Echague boundary remains a fallback; the intended boundary source is the corresponding OSM campus boundary. The first implementation is a one-time development import, not an automatic synchronization service.

## Rationale

OpenStreetMap provides reusable, current public geometry and supports the campus map’s need for buildings and outdoor paths. Keeping source metadata makes imported records traceable and correctable in the map editor. Treating paths as candidates acknowledges that public map data may omit gates, accessibility constraints, or campus-specific connections.

## Consequences

- The application must display required OpenStreetMap attribution wherever OSM data or tiles are shown.
- Imported records need source metadata so they can be inspected and regenerated.
- The generated fixture should remain separate from the existing mock data initially so the import can be compared and rolled back safely.
- Future refresh behavior must define how administrator corrections are preserved before scheduled synchronization is introduced.
