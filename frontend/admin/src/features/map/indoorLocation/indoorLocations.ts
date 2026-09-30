import type { Building, Location } from "../../../types";

export const isIndoorLocation = (location: Location) =>
  location.type === "Room" || location.type === "Office" || location.type === "Laboratory" || location.type === "Restroom";

export const belongsToBuilding = (location: Location, building: Building) =>
  location.parentId === building.id || location.building === building.name;

export const isPositionedLocation = (location: Location): location is Location & { lat: number; lng: number } =>
  location.positioned && location.lat !== null && location.lng !== null;

/** The parent Building Location an indoor Location is added under, derived from the Building when it has no Location record. */
export const indoorLocationParent = (building: Building, locations: Location[]): Location =>
  locations.find((location) => location.id === building.id && location.type === "Building") ?? {
    id: building.id,
    name: building.name,
    code: building.code,
    type: "Building" as const,
    parentId: null,
    status: building.status ?? "Active",
    lat: null,
    lng: null,
    positioned: false,
  };
