/** A ready-to-import starting point for location bulk-import files. */
export const createLocationsBulkImportTemplate = () => JSON.stringify([
  { id: "room-library-101", name: "Library Reading Room", code: "LIB-101", type: "Room", parentId: "building-library", floor: "Ground Floor", status: "Active", lat: null, lng: null },
  { id: "office-library-201", name: "Library Staff Office", code: "LIB-201", type: "Office", parentId: "building-library", floor: "2nd Floor", status: "Active", lat: null, lng: null },
  { id: "laboratory-library-301", name: "Library Research Laboratory", code: "LIB-301", type: "Laboratory", parentId: "building-library", floor: "3rd Floor", status: "Active", lat: null, lng: null },
  { id: "restroom-library-ground", name: "Library Ground Floor Restroom", code: "LIB-RR-G", type: "Restroom", parentId: "building-library", floor: "Ground Floor", status: "Active", lat: null, lng: null },
], null, 2);

/** The import format intentionally contains indoor children only. */
export const locationsBulkImportDescription =
  "Validate campus location records before importing: Room, Office, Laboratory, and Restroom records linked to an existing Building and specific Floor Level.";

export type LocationImportRequest = {
  json: string;
  commit?: boolean;
  mode?: "add" | "update";
};
