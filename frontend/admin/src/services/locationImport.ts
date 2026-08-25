/** A ready-to-import starting point for location bulk-import files. */
export const createLocationsBulkImportTemplate = () => JSON.stringify([
  { id: "bldg-library", name: "University Library", code: "LIB", type: "Building", parentId: null, status: "Active", lat: 16.7208, lng: 121.6892 },
  { id: "room-library-101", name: "Library Reading Room", code: "LIB-101", type: "Room", parentId: "bldg-library", building: "University Library", floor: "2nd Floor", status: "Active", lat: null, lng: null },
  { id: "facility-water-station", name: "Water Refill Station", code: "WATER-01", type: "Facility", parentId: null, status: "Active", lat: null, lng: null },
], null, 2);

export type LocationImportRequest = {
  json: string;
  commit?: boolean;
  mode?: "add" | "update";
};
