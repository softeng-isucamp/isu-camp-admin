
# ISU-CAMP Admin Portal

The portal is now a Vite + React + TypeScript application organized by feature modules. It follows the ISU-CAMP Figma administration mockup and uses the authenticated HTTP backend.

## Development

```bash
npm install
npm run dev
```

The frontend connects to the real backend at `http://127.0.0.1:5000` by default. Set `VITE_API_BASE_URL` when using another backend address. The backend must be running before starting the frontend.

## Verification

```bash
npm test
npm run build
```

Feature code lives under `src/features`; shared models and replaceable service contracts are in `src/types.ts` and `src/services`.

## Locations and indoor map markers

The Locations module manages campus-place names, codes, types, descriptions, parent buildings, and floor levels. Create and edit Locations, Route Nodes, Pathways, and building footprints individually. The admin portal does not provide bulk import workflows.

Building outlines are managed in Map Editor. An indoor location can have its own optional point inside its parent building's footprint, separate from the building's map position. To place one, choose a building, open its actions, select **Mark indoor location**, choose an existing room, office, laboratory, or restroom, then click inside the footprint while zoomed to level 20 or closer. Placed indoor markers are shown at that zoom level and closer, with a symbol for the location type.

In the Locations module, indoor coordinates are read-only. For an existing location, **Pick on map** opens Map Editor without saving other edits from the modal and zooms to its parent building. Click inside the footprint to preview or adjust the marker, then use **Save Position** in the sidecard to save only its coordinates. Creating a new indoor location still requires saving its record first so it has an ID before its position can be saved. Map position saves require an authenticated session.

Indoor marker support also requires the database contract described in the repository's [database prerequisites](../../README.md#database-prerequisites). Deploy the corresponding schema change before enabling the feature against a database that does not yet have coordinate columns.
