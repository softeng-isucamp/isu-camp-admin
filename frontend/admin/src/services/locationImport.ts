/** A ready-to-import starting point for location bulk-import files. */
const templateBuildingId = "osm-location-c5fb7a267a8ca63d";

export const createLocationsBulkImportTemplate = () => JSON.stringify([
  { id: "room-administration-101", name: "Administration Reading Room", code: "ADM-101", type: "Room", parentId: templateBuildingId, floor: "Ground Floor", status: "Active", lat: null, lng: null },
  { id: "office-administration-201", name: "Administration Staff Office", code: "ADM-201", type: "Office", parentId: templateBuildingId, floor: "2nd Floor", status: "Active", lat: null, lng: null },
  { id: "laboratory-administration-301", name: "Administration Research Laboratory", code: "ADM-301", type: "Laboratory", parentId: templateBuildingId, floor: "3rd Floor", status: "Active", lat: null, lng: null },
  { id: "restroom-administration-ground", name: "Administration Ground Floor Restroom", code: "ADM-RR-G", type: "Restroom", parentId: templateBuildingId, floor: "Ground Floor", status: "Active", lat: null, lng: null },
], null, 2);

/** The import format intentionally contains indoor children only. */
export const locationsBulkImportDescription =
  "Validate campus location records before importing: Room, Office, Laboratory, and Restroom records linked to an existing Building and specific Floor Level.";

export type LocationImportRequest = {
  json: string;
  commit?: boolean;
  mode?: "add" | "update";
};
