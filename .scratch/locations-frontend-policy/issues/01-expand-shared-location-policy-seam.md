# 01: Expand the shared Location policy seam

**What to build:** Introduce one framework-independent Location policy interface alongside the existing caller-specific rules. From an administrator's perspective, the same Location type, parent, coordinate, and placement facts can now be evaluated consistently for ordinary record editing and map readiness without changing existing workflows yet.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] One public Location policy interface owns type classification, parent eligibility, coordinate consistency, placement derivation, normalized draft transitions, and structured policy issues.
- [x] Room, Office, Laboratory, and Restroom are classified as indoor children that require a Building parent and cannot carry outdoor coordinates or a positioned state.
- [x] Floor is classified as an unpositioned Building child, and representative existing data is checked for compatibility with that rule.
- [x] Building and Facility are classified as outdoor-positionable records that may be valid before positioning.
- [x] Record validity and map readiness are distinct evaluation contexts behind the same interface; map readiness requires valid paired coordinates for outdoor Locations.
- [x] Parent identifiers are authoritative, Building names are derived from valid parent records, and stale parent metadata is cleared during normalization.
- [x] Latitude and longitude are accepted only when both are absent or both are present within geographic bounds; placement state is derived rather than independently toggled.
- [x] Type and parent transitions normalize incompatible hierarchy, floor, coordinate, and placement values atomically.
- [x] Policy tests cover every Location type, both evaluation contexts, valid and invalid parent kinds, coordinate edge cases, and representative curated/generated records.
- [x] The policy module remains independent of React, routing, query caching, and persistence transport.
- [x] Existing frontend tests remain green while the new interface exists beside the old caller-specific rules.
