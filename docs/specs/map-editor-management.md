# Map Editor Management Specification

## Purpose

Make every supported Map Editor action complete a real backend operation. Each tool has its own explicit Save, Update, or Delete action. The action must call an existing backend endpoint, report failure, and show the committed result after reload.

This specification intentionally stays within the current API and data model. It does not introduce a versioned API, a new draft gateway, or a map-wide transaction model.

## Scope

### In scope

- Building and Facility footprint creation.
- Editing and saving existing building footprint geometry.
- Deleting a Building through an explicit hard-delete confirmation.
- Creating, moving, editing, and deleting Route Nodes.
- Creating, editing, and deleting Pathways.
- Editing and removing Path Points belonging to a Pathway.
- Associating an Entrance Route Node with a Building.
- Error handling, authorization, audit logging, and refresh behavior for these actions.

### Out of scope

- Locations and Rooms as a management workflow. The existing Locations workflow remains authoritative.
- Local Map Feature persistence, including Vehicle Paths, Walkways, Parking Areas, and Campus Boundaries.
- Walking Network import.
- Pathway intersection/split operations.
- OpenStreetMap synchronization or export.
- Published Map Revisions and public publishing.
- A new versioned Map Editor API.
- A working map-wide `Save Changes` or `Discard` workflow.

Unsupported controls must not claim that they saved data. They should be hidden or disabled, except for the existing map-wide Save Changes and Discard controls, which remain visible but disabled while this work is in progress.

## Persistence model

### Tool-level commit

The Map Editor may hold incomplete drawing or editing work in a Tool Draft. A Tool Draft is not sent to the backend until the user presses the active tool's explicit Save, Update, Add, or Delete button.

- Save/Update validates and commits immediately through the existing API.
- Cancel closes the active tool without sending a mutation request.
- A failed request keeps the tool open and preserves the user's draft for retry.
- A successful request reloads the affected record from the backend.
- The map-wide Save Changes and Discard buttons are not part of this persistence model.

### Existing API rule

The frontend must use the existing endpoint families:

- `/api/map/buildings`
- `/api/locations` for the existing Building creation path
- `/api/route-nodes`
- `/api/pathways`
- `/api/path-points`
- `/api/map/save` only where an existing map geometry update still requires it

The frontend must not use the currently incomplete `/api/network/*` or test-only draft gateway as a production persistence path. If an existing endpoint cannot complete an in-scope action, add the smallest compatible endpoint or extend the existing endpoint rather than introducing a new API family.

## Functional requirements

### Buildings and footprints

1. Drawing a valid Building or Facility polygon and pressing Save must create the Building through the existing backend flow.
2. The selected Building classification must be preserved; Facility must not be silently converted to Building.
3. Reshaping an existing footprint and pressing Save must persist the complete polygon geometry.
4. Invalid polygons must not be submitted.
5. Delete must be an explicit hard delete named **Delete Building** for this scope.
6. Delete confirmation must state that the Building record and associated Indoor Locations are permanently removed, consistent with [ADR 0002](../adr/0002-cascade-permanent-building-deletion.md).
7. After deletion, the Building must no longer appear after reload.
8. The current Retire Footprint and Restore Footprint actions are not part of this change.

### Canvas selection

1. Select mode must treat a canonical Building and its linked footprint as one selectable object, even when the same Building ID is present in both the Locations and Building collections.
2. When a click overlaps multiple distinct objects, the disambiguation popover must list each canonical object once and must prefer the Building representation for a footprint-backed Building.
3. The disambiguation popover is labeled **Choose an object**; individual choices identify the object's name and kind.

### Route Nodes

1. Placing a Route Node and pressing Save must create it through `POST /api/route-nodes`.
2. Moving or editing a Route Node and pressing Update must persist through `PUT /api/route-nodes/:id`.
3. Entrance association changes must persist through the same explicit Update action.
4. Deactivate Route Node must be replaced by **Delete Route Node**.
5. Deleting a Route Node must use `DELETE /api/route-nodes/:id` and show the connected Pathway impact before confirmation.
6. Connected Pathways and their Path Points may be removed by the existing database cascade, but deletion must not happen silently and must complete in one backend transaction.
7. A successful deletion must remove the node and its affected network records after reload.

### Pathways and Path Points

1. Creating a Pathway and pressing Save must persist the Pathway and its Path Points.
2. Editing Pathway metadata and pressing Update must persist the changed metadata.
3. Editing, inserting, or removing Path Points must be committed when the active Pathway Save succeeds.
4. Path Point changes must not be reported as saved if any required request fails.
5. Close/Reopen Pathway must be replaced by **Delete Pathway** for this scope.
6. Delete Pathway must use `DELETE /api/pathways/:id` and hard-delete its Path Points.
7. A cancelled Pathway tool must not leave a newly created backend Pathway behind.
8. After a successful save or delete, reloading the Map Editor must show the backend geometry and metadata.

## Authorization and audit

Every mutation used by the Map Editor must:

- Require an authenticated administrator.
- Validate the request server-side.
- Commit related deletes/updates in one database transaction.
- Write an audit log entry in the same transaction.
- Return a consistent success or error response.
- Leave the frontend draft intact when the request fails.

The route-node, pathway, and path-point routes currently have no visible `admin_required()` guard in [route_node.py](../../app/routes/route_node.py). This must be corrected before those endpoints are considered connected and production-ready.

## UI requirements

- Every supported operation has a visible, action-specific Save, Update, Add, or Delete control.
- Delete controls require confirmation and name the object being deleted.
- Destructive controls must describe dependent records that will also be removed.
- The old map-wide Save Changes and Discard controls remain visible but disabled, with guidance to use the active tool's Save button.
- No UI action may display success when it only changed local React state.
- Unsupported Local Map Feature, import, split, publish, location, and room actions must not be presented as working Map Editor persistence features.

## Acceptance criteria

For every in-scope operation:

1. The frontend sends a real request to the expected existing endpoint.
2. The backend validates and commits the change.
3. The backend rejects unauthorized requests.
4. The frontend shows a useful error when the request fails.
5. The draft remains available for correction or retry after failure.
6. A successful request refreshes the affected data.
7. A full page reload shows the committed result.
8. The mutation creates a matching audit log entry.

Required scenarios include:

- Create, reshape, and delete a Building footprint.
- Create, move, update, associate, and delete a Route Node.
- Create, update, edit geometry, and delete a Pathway.
- Add, move, and remove Path Points.
- Delete a Route Node with connected Pathways and verify the confirmation and transaction behavior.
- Cancel every tool before Save and verify that no backend record is created or changed.
- Force each mutation endpoint to fail and verify that the editor does not report success or lose the draft.

## Implementation gaps identified by the audit

1. Wire the existing `deleteRouteNode`, `deletePathway`, and `removeBuilding` service methods to real Map Editor controls.
2. Replace Deactivate Route Node and Close/Reopen Pathway UI actions with hard-delete flows.
3. Make Building creation preserve the selected Building classification.
4. Complete Building geometry and metadata persistence through the existing endpoints used by the active tool Save button.
5. Prevent pathway creation or point replacement from leaving orphaned or partially saved data.
6. Add authorization and delete/failure tests for route nodes, pathways, and path points.
7. Disable the map-wide Save Changes and Discard controls.
8. Keep unsupported Local Map Feature and import/split controls outside the working persistence surface until a backend model is intentionally added.
