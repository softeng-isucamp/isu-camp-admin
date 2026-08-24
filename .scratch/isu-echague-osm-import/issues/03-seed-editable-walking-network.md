# 03: Seed the editable walking network from OSM paths

**What to build:** Extend the development import so explicit OSM pedestrian ways become reviewable route-node and pathway candidates for the ISU-CAMP walking network while preserving route-relevant source metadata and flagging unreliable geometry.

**Blocked by:** 01: Build the bounded OSM extraction and provenance fixture

**Status:** ready-for-agent

- [ ] Explicit footways, paths, pedestrian ways, steps, and tracks can produce pathway and route-node candidates.
- [ ] Route nodes and pathways retain source-way/source-node links.
- [ ] Surface, width, lit, access, foot, wheelchair, incline, and smoothness metadata is preserved when present.
- [ ] Service, residential, and unclassified roads are not automatically classified as safe pedestrian pathways.
- [ ] Boundary-crossing, invalid, isolated, missing-endpoint, self-connecting, and suspiciously long geometry is flagged for review.
- [ ] Path candidates use the existing pathway and route-node contracts with conservative defaults.
- [ ] The importer does not claim that the resulting network is complete or authoritative.
- [ ] Tests cover valid paths, sparse/disconnected paths, barriers, access tags, invalid geometry, and missing endpoints.
