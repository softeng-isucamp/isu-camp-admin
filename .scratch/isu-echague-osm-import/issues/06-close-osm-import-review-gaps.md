# 06: Close OSM import review gaps and stabilize verification

**What to build:** Complete the remaining review follow-up so the generated ISU-CAMP OpenStreetMap fixture is fully traceable and verifiably usable through the real map-service and Map Editor flows, while the frontend test suite runs consistently in local mode.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Frontend tests consistently use the intended local/mock API mode and the existing environment-related failures are resolved.
- [ ] Route nodes and pathways preserve source-way and source-node provenance through the generated fixture and frontend adapter.
- [ ] Connectivity tests cover paths joined through shared intermediate OSM nodes and flag genuinely disconnected components.
- [ ] Relation-backed candidates retain usable raw member structure and have normalization coverage.
- [ ] Map Editor tests cover generated-fixture loading, movement, pathway editing, building geometry validation, and boundary safeguards.
- [ ] Full importer tests, frontend tests, and frontend build pass.
- [ ] A final two-axis code review reports no unresolved spec findings that are in scope for this ticket.
- [ ] No synchronization, production writes, or live import UI are added.
