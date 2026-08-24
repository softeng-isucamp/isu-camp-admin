# 01: Build the bounded OSM extraction and provenance fixture

**What to build:** A development-only importer that consumes a bounded Overpass response for ISU Echague, applies the campus boundary, deduplicates source elements, and emits deterministic raw source records that can be used by later normalization steps.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The importer uses the documented relevant OSM tag families and the ISU Echague boundary/fallback.
- [ ] Complete element geometry is available for nodes, ways, and relations needed by normalization.
- [ ] Every retained source record preserves provider, source type, source ID, canonical URL, original tags, original geometry, and available version/timestamp/changeset metadata.
- [ ] The import records the query, endpoint, access/import date, and boundary version.
- [ ] Duplicate `(source type, source ID)` elements are emitted once.
- [ ] Generated source IDs are deterministic for identical input and distinct from OSM IDs.
- [ ] Outside-boundary and boundary-crossing elements are rejected or explicitly flagged rather than silently treated as campus data.
- [ ] Tests use recorded Overpass-shaped input and do not require network access.
