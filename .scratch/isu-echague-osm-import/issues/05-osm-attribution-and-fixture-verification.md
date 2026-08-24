# 05: Add OSM attribution and verify the imported map experience

**What to build:** Complete the development import by making OpenStreetMap attribution and source obligations visible, documenting the generated fixture, and verifying the end-to-end map-editor experience against the imported ISU data.

**Blocked by:** 04: Generate and integrate the replacement development fixture

**Status:** ready-for-agent

- [ ] The map visibly credits “© OpenStreetMap contributors” wherever OSM data or OSM tiles are displayed.
- [ ] The fixture documentation identifies the OSM source, ODbL availability, query/access date, and provenance expectations.
- [ ] The implementation does not bulk-download, prefetch, or archive OSM tiles.
- [ ] End-to-end verification confirms the imported fixture loads in the map editor.
- [ ] End-to-end verification confirms existing editing safeguards reject invalid and outside-boundary geometry.
- [ ] Relevant existing frontend tests remain green, with browser coverage added only for behavior not proven at the importer seam.
- [ ] Automatic synchronization, scheduled refreshes, production writes, and live import UI remain absent.
