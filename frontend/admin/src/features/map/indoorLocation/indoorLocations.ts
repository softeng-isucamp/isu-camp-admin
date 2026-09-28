import type { Building, Location } from "../../../types";

export const isIndoorLocation = (location: Location) =>
  location.type === "Room" || location.type === "Office" || location.type === "Laboratory" || location.type === "Restroom";

export const belongsToBuilding = (location: Location, building: Building) =>
  location.parentId === building.id || location.building === building.name;

export const isPositionedLocation = (location: Location): location is Location & { lat: number; lng: number } =>
  location.positioned && location.lat !== null && location.lng !== null;
