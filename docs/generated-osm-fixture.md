# Generated OSM development fixture

`frontend/admin/src/services/generated-map-fixture.json` is generated from the
recorded response at `app/importer/fixtures/overpass-recorded.json`:

```sh
python -m app.importer.generate_fixture
```

The source is OpenStreetMap data obtained through the Overpass API on
2026-08-24, using the bounded query recorded in the fixture. The data is
available under the Open Database License (ODbL). Records retain their source
URLs, OSM IDs, tags, import date, endpoint, query, and boundary version so
changes can be reviewed and re-generated deterministically.

The recorded sample contains five named campus buildings—Administration
Building, Main Library, Science Building, Cyber Library, and Student Center—
plus three explicit OSM pedestrian ways. It is intentionally small enough for
Map Editor development while retaining the source polygons, way nodes, tags,
IDs, and provenance.

This visual sample is not the importer's category-coverage fixture. Synthetic
normalization tests cover representative amenities, unnamed and invalid
buildings, barriers, parking, relations, rejected geometry, and connected and
disconnected pedestrian ways without expanding the Map Editor sample.

To load it in the development Map Editor, set `VITE_MAP_FIXTURE=osm`. Leaving
that variable unset keeps the previous mock data available for comparison and
rollback. This fixture contains data records only; the application does not
bulk-download, prefetch, or archive OSM tiles.

When OSM data or tiles are displayed, the UI must show: **© OpenStreetMap
contributors**. ODbL obligations should be reviewed before redistributing
derived production data.
