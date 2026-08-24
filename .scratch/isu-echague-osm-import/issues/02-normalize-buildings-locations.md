# 02: Normalize buildings and campus location candidates

**What to build:** Extend the development import so relevant OSM buildings, named places, amenities, parking, entrances, barriers, and named areas become reviewable ISU-CAMP building and location candidates with conservative classifications and source links.

**Blocked by:** 01: Build the bounded OSM extraction and provenance fixture

**Status:** ready-for-agent

- [ ] Closed building ways/relations become valid building footprint candidates.
- [ ] Named amenities and named areas become location candidates only where an existing application type is defensible.
- [ ] OSM names, official names, short names, references, and original classifications remain distinguishable.
- [ ] Unnamed footprints are retained as review candidates without invented names or official codes.
- [ ] Entrances and barriers are represented as candidates or building-adjacent location data without inferring access availability.
- [ ] Parking candidates preserve relevant source attributes and geometry.
- [ ] Missing official ISU names, rooms, floors, accessibility, ownership, and functions remain unknown rather than invented.
- [ ] Normalized records satisfy the existing location and building contracts.
- [ ] Each normalized record links back to its raw source record.
- [ ] Tests cover representative buildings, amenities, unnamed footprints, parking, entrances, barriers, unsupported classifications, and conservative defaults.
