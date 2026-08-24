# ISU Echague OSM map-data research

**Access date:** 2026-08-24 (Asia/Manila)

## Scope and conclusion

This report answers the map-data questions in the handoff for a development-only
replacement fixture. It does not change application code, publish an import, or
propose automatic synchronization.

OpenStreetMap currently has useful coverage for the ISU Echague area: the query
box returned 445 matching elements, including named campus buildings and
amenities, a large number of additional building footprints, service and local
roads, and a few explicitly tagged footways/paths. The box also contains
Echague town and roads outside the campus, so a returned object is an **import
candidate**, not automatically campus data. The first import should use the
existing ISU-CAMP boundary as a temporary clipping/review boundary, preserve
the raw OSM record, and treat paths as editable walking-network candidates.

## Sources and reproducible retrieval

The live coverage observation used this bounded Overpass request against the
official public endpoint:

```overpass
[out:json][timeout:60];
(
  nwr(16.7157,121.6835,16.7276,121.6984)[name];
  nwr(16.7157,121.6835,16.7276,121.6984)[building];
  nwr(16.7157,121.6835,16.7276,121.6984)[highway];
  nwr(16.7157,121.6835,16.7276,121.6984)[amenity];
  nwr(16.7157,121.6835,16.7276,121.6984)[entrance];
  nwr(16.7157,121.6835,16.7276,121.6984)[barrier];
  nwr(16.7157,121.6835,16.7276,121.6984)[parking];
);
out body geom;
```

The box is the existing fallback campus polygon's extent plus approximately
100 m. Overpass documents the bbox order as south, west, north, east, warns
that ways/relations can include members outside a bbox, and documents `out
meta` and `out geom` for metadata and complete geometry. See the [Overpass QL
bbox and output documentation](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).

For the actual development import, use a two-stage bounded query: fetch the
campus boundary candidate (if a suitable OSM relation/closed way is confirmed),
then query each relevant tag within that area and recurse to geometry. If no
usable OSM boundary exists, use the existing polygon as the retrieval bbox and
clip/reject candidates whose complete geometry is outside it. Keep the bbox
small, request only the required tag families, use `out meta geom`, and save
the response and query text with the fixture. Overpass is preferable to the
OSM editing API for this read-only one-time extraction: the OSMF API policy
says the editing API is for editing, not read-only projects, and directs large
or frequent readers to extracts or other alternatives. See the [OSM API usage
policy](https://operations.osmfoundation.org/policies/api/) and [Overpass API
documentation](https://wiki.openstreetmap.org/wiki/Overpass_API).

The official OSM API object pages are also useful for spot checks, for example
[way 426512735](https://www.openstreetmap.org/way/426512735), tagged
`amenity=university` and named “Isabela State University - Main Campus”, and
[way 426512739](https://www.openstreetmap.org/way/426512739), tagged as the
Cyber Library. These are evidence of current records, not a claim that every
record in the box belongs to the campus.

## Observed current coverage

The 2026-08-24 Overpass response contained 445 elements: 431 ways, 11
relations, and 3 nodes. Because the query is a union of tag filters, these are
element counts, not unique counts by category.

Notable named campus-related records observed include:

- “Isabela State University - Main Campus” (`amenity=university`),
  Administration Building, SB Classroom, College of Information Communication
  Technology, Computer Laboratory Building, Faculty Building, Main Library,
  Science Building, Chinese Building, Cyber Library, Abaya Hall, Student
  Supreme Council Building, Student Center, College of Engineering Library,
  Graduate School, Food Court, Laboratory High School, Cafeteria, Grandstand,
  and multiple agriculture/veterinary/research buildings.
- Amenities include university/college/school, library, clinic, café,
  restaurant, and a parking polygon. Two fuel nodes and a named climate
  information center also appeared in the broader box; these require boundary
  and campus-membership review.
- Building footprints are plentiful, but many are unnamed and tagged only
  `building=yes` or a broad building value such as `college`, `school`, or
  `residential`.
- Roads include `service`, `residential`, `unclassified`, and the surrounding
  `secondary`/`trunk` roads. Explicit pedestrian coverage is sparse in the
  response: a few `highway=footway` and `highway=path` ways were present. The
  query does not establish that those ways form a connected or complete
  walking network.
- A named sports oval and municipal/town features are in the box. Their
  presence demonstrates why the campus boundary must be applied before import.

Likely walking-network gaps are unnamed internal paths not mapped as
`highway=footway`/`path`, building-to-path connections, gates and crossings,
and access restrictions. Disconnection must be measured from the returned
geometry after import; it should not be inferred from aerial imagery or from
the existence of a single path tag.

## Tags and normalization

| OSM input | ISU-CAMP candidate | Preserve / normalize |
|---|---|---|
| `building=*` on closed way/relation | `Building` footprint; optionally a `Location` | geometry; `name`; building value; `levels`, `entrance`, `ref`, `operator`, `addr:*` when present |
| `amenity=university/college/school/library/clinic/cafe/restaurant/...` | named `Location`; possibly building if it also has `building=*` | amenity value becomes a source classification, not an invented internal type |
| `name=*`, `official_name=*`, `short_name=*`, `ref=*` | display-name candidate, code candidate | retain all source tags; do not turn OSM names into official ISU names without review |
| `highway=footway/path/pedestrian/steps/track` | `Pathway` and its vertices as `RouteNode` candidates | preserve highway, surface, width, lit, access, foot, wheelchair, incline, smoothness |
| `highway=service/residential/unclassified` | optional context/path candidate only after review | do not assume motor roads are pedestrian-safe; preserve access and surface |
| `entrance=main/yes/...` | entrance `Location` or building-adjacent route node | preserve entrance value and parent way/source reference |
| `barrier=gate/lift_gate/bollard/...` | gate/barrier candidate and possible network constraint | preserve barrier, access, locked, opening_hours; never infer open access |
| `amenity=parking` or `parking=*` | parking `Location`/area | preserve capacity, access, fee, surface, wheelchair and geometry |
| `place=*`, `leisure=*`, `sport=*`, `landuse=*` named areas | named-place/location candidate | review campus relevance and geometry before mapping to an application type |

Every imported record should retain `source.provider=OpenStreetMap`,
`source.type=node|way|relation`, `source.id`, the canonical object URL,
the complete original tag map, `version`, `timestamp`/`changeset` where
returned, and original geometry. Store the import run date, query, boundary
version, and classification/review status separately. This supports the
CONTEXT.md distinction between imported, import-candidate, and curated
records.

## Quality risks and validation

OSM is community-maintained and can be incomplete, stale, misnamed, duplicated,
or geometrically imperfect. Specific risks here are unnamed footprints,
over-broad building categories, town features inside the bbox, sparse footway
mapping, missing gates/entrances, disconnected paths, and uncertain access or
surface. OSM geometry is not proof of an official ISU room, building name,
ownership, accessibility, or safe route. Official ISU material can later
validate names and internal places; the [ISU Administrative Manual](https://isu.edu.ph/wp-content/uploads/2023/11/Administrative-Manual.pdf)
confirms Echague as the university's main campus/administrative site, but it
does not replace a campus facilities dataset.

Validation checklist for the first fixture:

- Record the exact query, endpoint, access date, boundary vertices, and source
  response checksum or archived response.
- Confirm every candidate's complete geometry is inside the campus boundary (or
  explicitly flag boundary-crossing ways for review); reject surrounding-town
  objects.
- Check unique `(source.type, source.id)` values, valid coordinates, closed
  building polygons, non-empty names only where a name exists, and no accidental
  duplicate geometry.
- Verify source metadata and original tags survive normalization; ensure
  generated application IDs are distinct from OSM IDs.
- Review named buildings/amenities against official ISU naming before marking
  them curated; leave unnamed footprints as review candidates.
- Check path vertices, segment lengths, crossings, endpoints, and whether each
  intended route node connects to at least one pathway. Flag isolated paths and
  suspiciously long jumps.
- Review `access`, `foot`, `wheelchair`, `surface`, `smoothness`, `lit`,
  `barrier`, and `entrance` tags; do not synthesize accessibility or gate
  availability when absent.
- Run the existing map-editor boundary and geometry validation against the
  generated fixture, compare counts with the raw extraction, and retain the
  old mock fixture for rollback/comparison.

## Licensing and attribution

OSM data is available under the [Open Database Licence (ODbL)](https://www.openstreetmap.org/copyright).
The OSM Legal FAQ requests “© OpenStreetMap contributors” and says users must
make the ODbL availability clear, normally with a link to the OSM copyright or
ODbL page. The application should show visible attribution wherever imported
OSM data or OSM-rendered tiles are displayed, including the admin map.

The current raster tile layer must also follow the [official OSM tile usage
policy](https://operations.osmfoundation.org/policies/tiles/): use the HTTPS
tile URL, visible attribution, an identifying User-Agent, a web Referer, and
HTTP caching; do not bulk-download, prefetch, or offer offline tile archives.
The policy is separate from the data licence and has best-effort availability.
For development fixtures, retain OSM source metadata and attribution in the
fixture documentation; if the fixture or a derived database is distributed,
have the project owner review ODbL attribution/share-alike obligations and any
combination with ISU-owned data before publication.

## Recommended first-import shape

Create a generated, reviewable fixture with four layers:

1. `rawSource`: one record per OSM element with source identity, metadata,
   original tags, and original geometry.
2. `importCandidates`: classified building, location, entrance/barrier,
   parking, and pathway candidates, each linked to `rawSource` and marked
   `imported`/`needs-review`.
3. `buildings` and `locations`: only the normalized subset needed by the
   existing mock-data contracts, with conservative names and nullable internal
   code/function fields.
4. `routeNodes` and `pathways`: path vertices and segments seeded from explicit
   pedestrian ways, retaining source-way/source-node links and leaving
   disconnected or uncertain segments reviewable.

Generate application IDs deterministically from source type and ID (with a
fixture prefix), preserve geometry in the application's latitude/longitude
convention, and do not flatten source tags into irreversible fields. Do not
infer rooms, floor plans, routes, gates, or missing names. The result should be
replaceable and comparable with the existing mock fixture.

## Primary references

- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL)
- [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)
- [OSM API usage policy](https://operations.osmfoundation.org/policies/api/)
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [OSM Legal FAQ](https://wiki.openstreetmap.org/wiki/Legal_FAQ)
- [OSM copyright and licence page](https://www.openstreetmap.org/copyright)
- [ISU Administrative Manual](https://isu.edu.ph/wp-content/uploads/2023/11/Administrative-Manual.pdf)
