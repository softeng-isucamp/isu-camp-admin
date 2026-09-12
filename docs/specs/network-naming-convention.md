# Walking Network Naming Convention

This convention applies to administrator-facing names for Route Nodes and
Pathways in the Map Editor. IDs remain technical identifiers and must not be
used as the displayed name.

## General rules

- Use the campus name that a visitor or administrator would naturally use.
- Use title case for proper names and ordinary sentence case for descriptors.
- Keep names concise: normally 2–5 words and no more than 80 characters.
- Use the official Building or Campus Location name when one exists.
- Do not include database IDs, OSM IDs, coordinates, distances, travel times,
  status, way type, or temporary labels such as `A`, `B`, or `new`.
- Do not use `Route`, `Path`, `Segment`, or `Node` as filler in a name. The
  record type already supplies that context.
- Names are labels, not unique identifiers. Uniqueness is recommended within
  the visible campus area but is not required by this convention.

## Route Node names

Use the following form based on the node's role:

| Node role | Format | Examples |
| --- | --- | --- |
| Entrance | `<Building or facility> Entrance` | `Library Entrance`, `Student Center Entrance` |
| Junction | `<Nearby area or landmark> Junction` | `Library Junction`, `Central Quad Junction` |
| Access Point | `<Nearby area or landmark> Access Point` | `North Field Access Point`, `Service Gate Access Point` |

If a Building has multiple entrances, add a stable directional or functional
qualifier before `Entrance`, such as `Library North Entrance` or `Library Main
Entrance`. Use `Main` only when the campus recognizes that entrance as the main
entrance; otherwise prefer a direction (`North`, `Southwest`) or a named side
(`Athletics Side`).

For a node that is not associated with a Building, name the nearest stable
area or landmark. Do not name a node after the pathway that currently happens
to connect to it.

## Pathway names

Use the form `<Endpoint A> – <Endpoint B>`, with an en dash and spaces. Endpoint
names should be the shortest recognizable names of the connected Route Nodes,
Buildings, facilities, gates, or stable campus areas.

Examples:

- `Main Gate – Arts Building`
- `Library Entrance – Central Quad Junction`
- `North Field – Student Center`

Pathway names are direction-neutral. They describe the same connection even
when source and destination are reversed, so reversing a Pathway must not by
itself change its name. Do not append `Walkway`, `Road`, `Pathway`, or a
direction suffix; those belong to the Pathway metadata fields.

When both endpoints have long names, shorten only with an established campus
abbreviation. Do not invent abbreviations merely to make the label shorter.

## Machine vocabulary

Human-facing labels and machine values are separate concerns. The canonical
values are:

| Concept | Canonical machine values | Human-facing labels |
| --- | --- | --- |
| Route Node role | `entrance`, `junction`, `access_point` | `Entrance`, `Junction`, `Access Point` |
| Path Point role | `waypoint` | `Waypoint` |
| Pathway way type | `walkway`, `road` | `Walkway`, `Road` |

Backend/database fields use `snake_case`; TypeScript fields use `camelCase`;
API conversion is the only place where these representations should be
translated. The existing API still accepts some historical title-case values
(such as `Walkway` and `Waypoint`); those are compatibility values, not naming
patterns for new code. A future normalization migration should make the
canonical values above consistent end to end.

## Examples to avoid

| Avoid | Use instead | Reason |
| --- | --- | --- |
| `Route Node 17` | `Central Quad Junction` | Technical ID is not a useful label |
| `Junction A` | `Library Junction` | Letter labels are unstable |
| `Library Entrance Walkway` | `Library Entrance – Central Quad` | Way type is metadata |
| `Pathway 42` | `Main Gate – Arts Building` | Record ID is not a human name |
| `Campus walkway` as a type | `Walkway` | Canonical way type is controlled |
