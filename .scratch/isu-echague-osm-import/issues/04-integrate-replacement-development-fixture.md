# 04: Generate and integrate the replacement development fixture

**What to build:** Combine the raw source records, normalized campus locations/buildings, and seeded walking network into a reviewable fixture that the existing map services and Map Editor can load, while preserving the previous mock data for comparison and rollback.

**Blocked by:** 02: Normalize buildings and campus location candidates; 03: Seed the editable walking network from OSM paths

**Status:** ready-for-agent

- [ ] The generated fixture contains the raw source, import candidates, normalized buildings/locations, route nodes, and pathways needed by the current map services.
- [ ] The fixture is reproducible from recorded input and has stable generated IDs.
- [ ] The existing development mock remains available for comparison or rollback during integration.
- [ ] The generated records satisfy existing schemas and map-draft validation.
- [ ] The current Map Editor loads the generated fixture and displays locations, buildings, route nodes, and pathways.
- [ ] Existing placement, movement, pathway editing, building geometry, and campus-boundary safeguards continue to work.
- [ ] Tests verify fixture comparison and loading without requiring a live Overpass request.
- [ ] A command-level or integration test verifies the complete recorded-response-to-fixture flow.
