# ISU-CAMP Context

## Domain glossary

- **Campus map data**: geographic records used by ISU-CAMP for the ISU Echague campus, including buildings, relevant places, paths, entrances, and route geometry.
- **Imported record**: an application record derived from OpenStreetMap data and carrying source metadata such as the OSM object ID and original tags.
- **Curated record**: an imported record that has been reviewed or corrected by an administrator in the map editor.
- **Import candidate**: a record discovered from OpenStreetMap that is available for classification and review before being treated as curated campus data.
- **Walking network**: the outdoor pedestrian route graph composed of route nodes and editable pathways across campus.
- **Campus boundary**: the geographic polygon defining the ISU Echague area from which relevant OpenStreetMap objects are gathered and within which editable geometry must remain.
- **Map editor**: the administrator workflow for reviewing, correcting, placing, and connecting campus map data.

## Current scope

The development import will gather relevant OpenStreetMap objects within the ISU Echague campus boundary. It will cover mapped buildings, roads, footways, paths, entrances, gates, parking, amenities, and named places. It will not infer unmapped places from satellite imagery or copy geometry from unrelated map providers.

The first import is development-only. It generates a replacement mock dataset for testing locations, routes, and the map editor. Future synchronization behavior is intentionally out of scope until the imported dataset and review workflow are validated.
