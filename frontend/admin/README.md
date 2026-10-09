
# ISU-CAMP Admin Portal

The portal is now a Vite + React + TypeScript application organized by feature modules. It follows the ISU-CAMP Figma administration mockup and uses the authenticated HTTP backend.

## Development

```bash
npm install
npm run dev
```

The frontend uses the real backend at `http://localhost:5000` by default. Set `VITE_API_BASE_URL` when using another backend address. The backend must be running before starting the frontend. Open the portal at `http://localhost:5173` to match backend CORS; Vite can choose another port if 5173 is occupied, so check its startup output.

For an explicit runtime, use the root runners: `./dev.sh --real` starts Flask and the frontend; `./dev.sh --fixture` starts only the OSM demo with the local adapter. Windows equivalents and fixture-only credentials are in [fixture versus real backend](../../README.md#fixture-versus-real-backend). Unit and browser test configurations select their own adapters; running a test does not establish the mode of an already-running development server.

## Verification

```bash
npm test
npm run build
```

For release assets, use `npm run test:production`, `npm run build:production`, and `npm run verify:production`. The guarded build ignores dotenv files and enforces real-backend, same-origin API settings. Container builds, clean-commit releases, and CI are documented in the [production recipe](../../deploy/README.md).

Feature code lives under `src/features`; shared models and replaceable service contracts are in `src/types.ts` and `src/services`.

## Code navigation

[MapEditor.tsx](src/features/map/MapEditor.tsx) composes the map workflows. Start with the owner below when changing a particular behavior.

| Behavior | Start here |
| --- | --- |
| Selection and overlapping objects | [useMapSelection.ts](src/features/map/selection/useMapSelection.ts), [selectionCandidates.ts](src/features/map/selectionCandidates.ts), and [selectedMapObjects.ts](src/features/map/selection/selectedMapObjects.ts) own selection state, click disambiguation, and resolving the selected record. |
| Building creation and footprint editing | [BuildingFootprintWorkflow.ts](src/features/map/building/BuildingFootprintWorkflow.ts) owns the creation/save sequence; [useBuildingFootprintEditing.ts](src/features/map/building/useBuildingFootprintEditing.ts) connects it to the editor. [BuildingDetailsModal.tsx](src/features/map/building/BuildingDetailsModal.tsx) edits metadata. |
| Indoor markers | [useIndoorLocationPlacement.ts](src/features/map/indoorLocation/useIndoorLocationPlacement.ts) owns placement and position saves; [indoorLocations.ts](src/features/map/indoorLocation/indoorLocations.ts) resolves building membership; [useVisibleIndoorLocations.ts](src/features/map/indoorLocation/useVisibleIndoorLocations.ts) controls visibility. |
| Location hierarchy and validation | [Locations.tsx](src/features/locations/Locations.tsx) owns the directory, hierarchy, and create/edit forms; [ParentBuildingField.tsx](src/features/locations/ParentBuildingField.tsx) owns the parent-Building type-ahead (filters by name or code, chooses by pointer or keyboard); [locationPolicy.ts](src/lib/locationPolicy.ts) owns identity keys, classification, and parent/floor validation. |
| Server data and unsaved map edits | [useSessionMapData.ts](src/features/map/session/useSessionMapData.ts) combines directory data with session overlays. [api.ts](src/services/api.ts) selects the service adapter and translates HTTP records; [network.ts](src/services/network.ts) handles network contracts. |
| User Management | [Users.tsx](src/features/users/Users.tsx) owns the two-tab directory; [AdministratorsPanel.tsx](src/features/users/AdministratorsPanel.tsx) owns administrator accounts (add/deactivate/remove and a password reset code, backed by `/api/admins`). Neither tab edits an account's details: those belong to their holder, and an app account's profile belongs to the User App. What both tabs do own is access — `status`, set through `/api/admins/<id>/status` and `/api/users/<id>/status` — plus a deep link to the account's System Logs activity. |
| Deleting a record | Every permanent delete is re-authenticated. [PasswordConfirmation.tsx](src/features/auth/PasswordConfirmation.tsx) owns the prompt and the `POST /api/confirm-password` round trip; the backend's `reauth_required` guard enforces it, so a delete refused with `password_confirmation_required` re-prompts rather than failing. |
| Progress and outcome reporting | [UI.tsx](src/components/UI.tsx) owns `Spinner`, `LoadingState`, `ProgressBar`, and the `Button` `loading` prop used by every in-flight action. [Feedback.tsx](src/components/Feedback.tsx) owns `useFeedback`/`FeedbackStack`, the self-dismissing "added / updated / deleted successfully" reports. A failure that keeps its dialog open stays inline in that dialog instead. |
| Map integration tests | [mapEditorTestHarness.tsx](src/features/map/testing/mapEditorTestHarness.tsx) and [mapEditorMocks.tsx](src/features/map/testing/mapEditorMocks.tsx) provide shared setup. Workflow tests live beside their owners, including `MapEditor.selection.test.tsx`, `MapEditor.building.test.tsx`, and `MapEditor.indoorLocation.test.tsx`. |
| Test runtime and browser coverage | [vitest.config.ts](vitest.config.ts) selects the local adapter for unit/integration tests; [src/test/setup.ts](src/test/setup.ts) sets up the test environment. [playwright.config.ts](playwright.config.ts) runs fixture browser tests; [playwright.locations-real.config.ts](playwright.locations-real.config.ts) covers the HTTP adapter with intercepted responses. The default browser suite excludes `indoor-location-marker.spec.ts`. |

Two relationships matter when working across these owners:

- **Identity is scoped by type.** A Building and a Room can have the same ID. Preserve the location subtype and ID when selecting or joining locations; use `locationIdentityKey` from `locationPolicy.ts` for mixed location collections.
- **Building metadata and geometry share one building identity.** The Locations directory supplies its descriptive record, and the map supplies its footprint. `useSessionMapData.ts` combines these views by building ID; `selectionCandidates.ts` collapses the Building/Facility directory candidate and its footprint into one selectable object. Indoor locations remain separate records linked to their parent building.

## Locations and indoor map markers

The Locations module manages campus-place names, codes, types, descriptions, parent buildings, and floor levels. Create and edit Locations, Route Nodes, Pathways, and building footprints individually. The admin portal does not provide bulk import workflows.

Building outlines are managed in Map Editor. An indoor location can have its own optional point inside its parent building's footprint, separate from the building's map position. To place one, choose a building, open its actions, select **Mark indoor location**, choose an existing room, office, laboratory, or restroom, then click inside the footprint while zoomed to level 20 or closer. Placed indoor markers are shown at that zoom level and closer, with a symbol for the location type.

In the Locations module, indoor coordinates are read-only. For an existing location, **Pick on map** opens Map Editor without saving other edits from the modal and zooms to its parent building. Click inside the footprint to preview or adjust the marker, then use **Save Position** in the sidecard to save only its coordinates. Creating a new indoor location still requires saving its record first so it has an ID before its position can be saved. Map position saves require an authenticated session.

Indoor marker support also requires the database contract described in the repository's [database prerequisites](../../README.md#database-prerequisites). Deploy the corresponding schema change before enabling the feature against a database that does not yet have coordinate columns.
