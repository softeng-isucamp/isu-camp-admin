import { isLocationContainer } from "../../../lib/locationPolicy";
import type { Building, Location } from "../../../types";

export const isIndoorLocation = (location: Location) =>
  location.type === "Room" || location.type === "Office" || location.type === "Laboratory" || location.type === "Restroom";

export const belongsToBuilding = (location: Location, building: Building) =>
  location.parentId === building.id || location.building === building.name;

export const isPositionedLocation = (location: Location): location is Location & { lat: number; lng: number } =>
  location.positioned && location.lat !== null && location.lng !== null;

/** The Building a Location sits in: its parent by ID, else the Building its record names. Places have none. */
export const parentBuildingOf = (location: Location, buildings: Building[]): Building | undefined =>
  location.type === "Place"
    ? undefined
    : buildings.find((building) => building.id === location.parentId) ?? buildings.find((building) => belongsToBuilding(location, building));

/** The bounds that frame a Building's footprint, or null when it has too few points to be an area. */
export const footprintBounds = (points: [number, number][]): [[number, number], [number, number]] | null =>
  points.length >= 3
    ? [
      [Math.min(...points.map(([lat]) => lat)), Math.min(...points.map(([, lng]) => lng))],
      [Math.max(...points.map(([lat]) => lat)), Math.max(...points.map(([, lng]) => lng))],
    ]
    : null;

/** The parent Building Location an indoor Location is added under, derived from the Building when it has no Location record. */
export const indoorLocationParent = (building: Building, locations: Location[]): Location =>
  locations.find((location) => location.id === building.id && isLocationContainer(location)) ?? {
    id: building.id,
    name: building.name,
    code: building.code,
    type: "Place" as const,
    classification: building.classification,
    parentId: null,
    status: building.status ?? "Active",
    lat: null,
    lng: null,
    positioned: false,
  };
