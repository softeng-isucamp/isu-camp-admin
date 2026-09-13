# Campus Locations

The campus locations context names the places administrators manage and visitors can discover within the ISU campus.

> [!NOTE]
> **Repository Scope**: This repository (`isu-camp-admin`) contains the **Admin App** (Flask backend and Vite/React admin portal). The companion client-facing **User App** (visitor discovery and navigation) lives in a separate repository.

## System Context

**Admin App** (Current Repository):
The administration backend and portal used by administrators to author, manage, validate, and publish campus locations, walking networks, and map data.
_Avoid_: User app, public app, client app

**User App** (External Repository):
The public/student client application maintained in a separate repository that consumes published campus data for location discovery and route navigation.
_Avoid_: Admin app, management portal

## Language

**Campus Location**:
A named campus place that can be managed and discovered, such as a building, room, office, laboratory, restroom, or standalone facility.
_Avoid_: Place, map object

**Building**:
An outdoor Campus Location with a physical footprint. A Building may contain Indoor Locations; a Building without Indoor Locations remains valid but shows an advisory that its information is incomplete. Locations remains the authoritative management context for identity and descriptive content; Map Editor owns the linked footprint geometry. Its routability depends on valid positioning and at least one active associated Entrance Route Node.
_Avoid_: Parent location, building location

**Facility**:
A Building classification for a mapped campus place that has a physical footprint but does not contain Indoor Locations, such as a canteen, open gym, parking area, or sports oval. Facilities use the same footprint, map, and pathfinding rules as Buildings, but do not require Indoor Location management.
_Avoid_: Landmark, point facility, outdoor marker

**Building classification**:
The classification of a footprint-backed Building as either Building or Facility. Building supports Indoor Locations; Facility does not.
_Avoid_: Building type, place type

**Indoor Location**:
A room, office, laboratory, or restroom that belongs directly to one Building and has a Floor Level rather than its own outdoor map position.
_Avoid_: Child location, nested place

**Floor Level**:
A standardized label, such as Ground Floor or 2nd Floor, used to group Indoor Locations within a Building; it is not a separately managed Campus Location.
_Avoid_: Floor record, Floor location, floor entity

**Unspecified Floor**:
The grouping for an existing Indoor Location whose Floor Level is not yet known; newly created Indoor Locations must have a specific Floor Level.
_Avoid_: No floor, standalone room

## User Management & Activity Monitoring

**App User**:
An end-user account belonging to the companion User App (such as a student or campus visitor). Within the Admin App, App Users are observed strictly as a read-only directory of username and registration data rather than managed or mutated. Last-sign-in activity is not part of the current directory contract because the source schema has no authoritative timestamp.
_Avoid_: Admin user, portal staff, managed account

**User Directory**:
The read-only tabular presentation of App Users in the Admin App, filterable by username query and registration date range.
_Avoid_: User management console, account editor

**Audit Log Entry**:
An immutable record capturing a notable event across the KUMPAS ecosystem, classified by Category (Admin, User, or System), Actor, Action, Target, and optional contextual Detail.
_Avoid_: Debug log, server trace, application console

**Audit Category**:
A top-level grouping for an Audit Log Entry:
- `Admin`: Administrative mutations performed within the Admin App (e.g. updating a Location, publishing a map draft, creating a Pathway).
- `User`: Public activity performed by App Users from the User App (e.g. searching a location, generating a route).
- `System`: Automated or platform-level events (e.g. scheduled imports, authentication attempts).
_Avoid_: Log level, priority, event severity

## Walking Network

**Pathway**:
A managed walkable connection between two Route Nodes, with ordered Path Points describing its geometry and metadata describing its movement and operating conditions. Its human-facing name identifies the two endpoints and is direction-neutral. It remains distinct from geometrically aligned Local Map Features and is never changed by them implicitly.
_Avoid_: Route, path segment, corridor (as the canonical entity name)

**Way type**:
A controlled physical classification for a Pathway: Walkway or Road. A Walkway is walking-only and cannot allow Vehicle mode; a Road may allow Walking, Vehicle, or both according to its Allowed modes.
_Avoid_: Pathway subtype, Local Map Feature family

**Pathway Policy Finding**:
An identified condition when a proposed Pathway or Pathway action is evaluated against the administered walking network. A blocking violation makes the proposal ineligible; an advisory warning identifies incomplete quality data without making an otherwise valid proposal ineligible.
_Avoid_: Save error, backend failure, override

**Route**:
A calculated journey across one or more Pathways; it is not a separately managed map record in the admin network.
_Avoid_: Pathway, route record

**Route Node**:
A network point used as an endpoint or junction for Pathways. It is not a Campus Location; an Entrance Route Node may be associated with one Building. Its human-facing name describes its role and nearest stable campus reference; it does not contain an ID, coordinates, status, or pathway type.
_Avoid_: Routing point, map pin, waypoint (unless referring to an implementation detail)

**Entrance Route Node**:
A Route Node whose Entrance type and Building association represent a pedestrian entrance to that Building and make it reachable from the walking network. Clearing the Building association returns it to a non-Entrance Route Node. A Building may have multiple entrances; inactive entrances remain associated but do not make the Building routable.
_Avoid_: Building marker, destination point, entrance location

**Path Point**:
An ordered intermediate coordinate in a Pathway’s Path Sequence between its source and destination Route Nodes, represented canonically by named latitude and longitude fields.
_Avoid_: Route point, node (unless it is actually a Route Node)

**Path Sequence**:
The ordered group of zero or more intermediate Path Points belonging to one Pathway; it is a value within the Pathway, not a separately managed record.
_Avoid_: Path record, Route

**Pathway Intersection**:
A crossing or meeting of Pathways represented by one shared Route Node through which routing may continue. Grade-separated Pathway crossings such as bridges are not part of the campus network model.
_Avoid_: Visual-only crossing, implicit junction

**Routable Building**:
A Building that is active, validly positioned, and has at least one active associated Entrance Route Node; reaching the selected entrance counts as reaching the Building.
_Avoid_: Routed building, navigable room

**Building Network Reference**:
The use of a Building's Campus Location ID by the walking network for Entrance Route Node associations and derived routability. It does not make the walking network an owner of the Building's identity, descriptive content, status, or footprint.
_Avoid_: Network Building record, duplicate Building

## Local Map Data

**Local Map Feature**:
A project-scoped cartographic object whose local record owns its geometry, rendering properties, raw source tags, and OSM lineage. It remains distinct from any Campus Location, Building, Route Node, or Pathway even when explicitly linked to one.
_Avoid_: Map object, OSM entity, Campus Location

**Editable Feature Family**:
A curated kind of Local Map Feature that administrators may create, modify, or retire. The supported families are Building Footprint, Vehicle Path, Walkway, Parking Area, and Campus Boundary; they have no subtype taxonomy. Imported features outside these families remain visible but read-only.
_Avoid_: Arbitrary OSM feature, editable layer

**Vehicle Path**:
A line-shaped Local Map Feature depicting a way intended for vehicles. It is campus cartography, not a routing record, and has no relationship or topology semantics.
_Avoid_: Service Road, Pathway, Route

**Walkway**:
A line-shaped Local Map Feature depicting a pedestrian way. It remains distinct from a Pathway even when their geometry corresponds.
_Avoid_: Footway subtype, Pathway, pedestrian Route

**Parking Area**:
An area-shaped Local Map Feature depicting parking, without a further area-kind or parking subtype classification.
_Avoid_: Plaza, parking subtype

**Campus Boundary**:
The single active area-shaped Local Map Feature defining the authoritative editable campus extent. Replacing it and resolving any resulting out-of-bound features is one atomic map change.
_Avoid_: Project boundary collection, barrier, restricted-area boundary

**Feature Link**:
An explicit association between a Local Map Feature and an application-owned record without merging their identities or ownership boundaries.
_Avoid_: Automatic match, shared record

**Linked Building Footprint**:
The one active Local Map Feature explicitly associated with a Building to provide its campus footprint; it may contain multiple polygons or holes while remaining one logical feature.
_Avoid_: Building record, automatically matched footprint

**Feature Anchor**:
A derived point guaranteed to lie on a polygonal Local Map Feature and used to place its label or selection marker. It is recalculated from authoritative geometry and is not an independently editable position.
_Avoid_: Building marker, centroid, saved center point

**Retired Local Map Feature**:
A Local Map Feature removed from the active local map while its identity and history are retained for recovery and reconciliation.
_Avoid_: Deleted OSM feature, hard-deleted feature

**Cleared Position**:
The state of an active Campus Location whose owned coordinate or Linked Building Footprint has been explicitly removed without deactivating the Campus Location.
_Avoid_: Deleted location, removed record

**Inactive Route Node**:
A Route Node excluded from active routing while its identity, relationships, position, and history are retained.
_Avoid_: Deleted node, closed node

**Closed Pathway**:
A Pathway excluded from active traversal while its identity, endpoint relationships, Path Sequence, metadata, and history are retained.
_Avoid_: Deleted Pathway, inactive Pathway

**Unlinked Association**:
A Feature Link or Entrance-to-Building association that has been explicitly removed without deactivating either associated record.
_Avoid_: Deleted feature, deleted Building, deleted Entrance Route Node

## Map Editing Lifecycle

**Published Map Revision**:
An immutable, public-facing snapshot promoted from one validated Admin Draft revision. It is unaffected by later draft saves.
_Avoid_: Live draft, saved map

**Admin Draft**:
The project's single shared, durable unpublished map state, identified by a revision and changed only through an authorized save.
_Avoid_: Private draft, published map

**Working Session**:
One administrator's recoverable browser-local operations based on a specific Admin Draft revision, including unsaved finalized changes and undo/redo history.
_Avoid_: Admin Draft, autosaved map

**Tool Draft**:
Incomplete, resumable work owned by one map-editing tool. Tool Finalization turns it into a finalized Working Operation, while cancelling discards it.
_Avoid_: Unsaved finalized change, Admin Draft

**Tool Finalization**:
The completion of one Tool Draft as a validated Working Operation eligible for a Working Session Save. It ends incomplete tool work but does not determine when the change reaches the Admin Draft.
_Avoid_: Tool Save, Admin Draft Save, autosave

**Working Session Save**:
The authorized transfer of one or more finalized Working Operations from a Working Session into the Admin Draft. The current lifecycle performs it immediately after each Tool Finalization; a later lifecycle may perform it explicitly for accumulated operations.
_Avoid_: Tool Finalization, Publish, autosave

**Map Editor Managed Object**:
A map record edited by the current Map Editor scope: a Building with its footprint geometry, a Route Node, a Pathway, a Path Point, or an Entrance-to-Building association.
_Avoid_: Indoor Location, Local Map Feature (unless explicitly brought into a later editing scope)

## Map Data Direction

The map editor is intended to evolve toward a project-scoped, locally managed copy of OpenStreetMap data for the campus area. The editor should be able to modify building footprints, names, water features, roads, and other relevant OSM-derived features within that scope.

The local dataset is preferred for project editing because changes can remain specific to this application and do not automatically become public OpenStreetMap contributions. OSM-derived data still requires OpenStreetMap attribution and compliance with the ODbL when the dataset or derived database is distributed.

The current map has two distinct technical concerns:

- Leaflet renders the basemap using OpenStreetMap street tiles and Esri satellite tiles.
- The map editor draws application-managed building and pathway geometry as overlays.

Future map work should make the local OSM-derived dataset the source for editable map features, replacing the current fixture/overlay-only workflow where appropriate. A later synchronization or export path to OpenStreetMap may be added separately; publishing edits directly to OSM requires OAuth 2.0, version/conflict handling, changesets, and compliance with OSM editing policies.

References: [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6), [OSM API policy](https://operations.osmfoundation.org/policies/api/), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).
