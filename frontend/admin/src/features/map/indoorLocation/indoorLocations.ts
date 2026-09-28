import type { Building, Location } from "../../../types";

export function normalizeFloorLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^ground(\s+floor)?$/i.test(trimmed)) return "Ground Floor";
  if (/^basement(\s+floor)?$/i.test(trimmed)) return "Basement";
  const ordinal = trimmed.match(/^(\d+)\s*(st|nd|rd|th)(\s+floor)?$/i);
  if (ordinal) return `${ordinal[1]}${ordinal[2].toLowerCase()} Floor`;
  return trimmed;
}

export const isIndoorLocation = (location: Location) =>
  location.type === "Room" || location.type === "Office" || location.type === "Laboratory" || location.type === "Restroom";

export const belongsToBuilding = (location: Location, building: Building) =>
  location.parentId === building.id || location.building === building.name;

export const isPositionedLocation = (location: Location): location is Location & { lat: number; lng: number } =>
  location.positioned && location.lat !== null && location.lng !== null;
