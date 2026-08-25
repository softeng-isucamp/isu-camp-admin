import type { Building, Location, Pathway, RouteNode } from "../../types";
import { geometryOnCampus, pointOnCampus, type MapPoint } from "./campusBoundary";

export const polygonCentroid = (points: MapPoint[]): MapPoint => points.length
  ? [points.reduce((sum, [lat]) => sum + lat, 0) / points.length, points.reduce((sum, [, lng]) => sum + lng, 0) / points.length]
  : [0, 0];

export type MapObjectType = "location" | "node" | "pathway" | "building";
export type MapChangeKind = "added" | "moved" | "renamed" | "deleted" | "edited";

export interface MapSnapshot {
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
  buildings: Building[];
}

export interface MapObjectReference {
  type: MapObjectType;
  id: string;
  label?: string;
}

export interface MapValidationError {
  object: MapObjectReference;
  message: string;
}

export interface MapChangeGroup {
  kind: MapChangeKind;
  objects: MapObjectReference[];
}

export interface MapDraftReview {
  valid: boolean;
  errors: MapValidationError[];
  groups: MapChangeGroup[];
}

const validCoordinate = ([lat, lng]: [number, number]) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const label = (object: { name: string }) => object.name.trim() || "Unnamed object";
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function reviewMapDraft(input: {
  original: MapSnapshot;
  current: MapSnapshot;
  deleted: MapObjectReference[];
  campusBoundary?: MapPoint[];
}): MapDraftReview {
  const { original, current, deleted, campusBoundary } = input;
  const errors: MapValidationError[] = [];
  const groups = new Map<MapChangeKind, MapObjectReference[]>();
  const addChange = (kind: MapChangeKind, object: MapObjectReference) =>
    groups.set(kind, [...(groups.get(kind) ?? []), object]);
  const addError = (object: MapObjectReference, message: string) => errors.push({ object, message });

  const collections: Array<[MapObjectType, Array<Location | RouteNode | Pathway | Building>, Array<Location | RouteNode | Pathway | Building>]> = [
    ["location", original.locations, current.locations], ["node", original.nodes, current.nodes],
    ["pathway", original.pathways, current.pathways], ["building", original.buildings, current.buildings],
  ];
  for (const [type, before, after] of collections) {
    const originals = new Map(before.map((object) => [object.id, object]));
    for (const object of after) {
      const reference = { type, id: object.id, label: label(object) };
      const previous = originals.get(object.id);
      if (!previous) {
        addChange("added", reference);
        continue;
      }
      const renamed = object.name !== previous.name;
      const moved = (type === "location" || type === "node") &&
        ("lat" in object && "lat" in previous) && (object.lat !== previous.lat || object.lng !== previous.lng);
      if (moved) addChange("moved", reference);
      if (renamed) addChange("renamed", reference);
      const ignored = new Set(["name", ...(moved ? ["lat", "lng"] : [])]);
      const rest = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
      if (!same(rest(object as unknown as Record<string, unknown>), rest(previous as unknown as Record<string, unknown>))) {
        addChange("edited", reference);
      }
    }
  }
  deleted.forEach((object) => addChange("deleted", object));

  const locationIds = new Set(current.locations.map((object) => object.id));
  const nodeIds = new Set(current.nodes.map((object) => object.id));
  current.locations.forEach((object) => {
    const reference = { type: "location" as const, id: object.id, label: label(object) };
    if (!object.name.trim()) addError(reference, "Location name is required.");
    if (!object.code.trim()) addError(reference, "Location code is required.");
    if (!object.type) addError(reference, "Location type is required.");
    if (!object.status) addError(reference, "Location status is required.");
    const isUnpositionedChild = ["Room", "Office", "Laboratory", "Restroom"].includes(object.type);
    if (isUnpositionedChild) {
      if (object.lat !== null || object.lng !== null || object.positioned) addError(reference, "Child locations must remain unpositioned on the outdoor map.");
      if (!object.parentId) addError(reference, "Child locations must reference a parent Building.");
    } else if (object.lat === null || object.lng === null || !validCoordinate([object.lat, object.lng])) {
      addError(reference, "Location latitude and longitude must be valid coordinates.");
    }
    if (object.parentId && !locationIds.has(object.parentId)) addError(reference, "Parent Location does not exist.");
    if (isUnpositionedChild && object.parentId && !current.locations.some((parent) => parent.id === object.parentId && parent.type === "Building")) {
      addError(reference, "Child locations must reference a Building parent.");
    }
  });
  current.nodes.forEach((object) => {
    const reference = { type: "node" as const, id: object.id, label: label(object) };
    if (!object.name.trim()) addError(reference, "Route Node name is required.");
    if (!object.nodeType) addError(reference, "Route Node type is required.");
    if (!validCoordinate([object.lat, object.lng])) addError(reference, "Route Node latitude and longitude must be valid coordinates.");
    if (object.associatedPlaceId && !locationIds.has(object.associatedPlaceId)) addError(reference, "Associated Location does not exist.");
  });

  const connections = new Map<string, string>();
  current.pathways.forEach((object) => {
    const reference = { type: "pathway" as const, id: object.id, label: label(object) };
    if (!object.name.trim()) addError(reference, "Pathway name is required.");
    if (!object.type.trim()) addError(reference, "Pathway type is required.");
    if (!object.direction) addError(reference, "Pathway direction is required.");
    if (!object.status) addError(reference, "Pathway status is required.");
    if (!nodeIds.has(object.sourceNodeId) || !nodeIds.has(object.destinationNodeId)) addError(reference, "Pathway endpoints must reference existing Route Nodes.");
    if (object.sourceNodeId === object.destinationNodeId) addError(reference, "Pathway connects a Route Node to itself.");
    const key = [object.sourceNodeId, object.destinationNodeId].sort().join("::");
    const duplicate = connections.get(key);
    if (duplicate && object.sourceNodeId !== object.destinationNodeId) addError(reference, `Pathway duplicates the connection already used by ${duplicate}.`);
    else connections.set(key, label(object));
    object.pathPoints.forEach((point) => {
      if (!validCoordinate(point)) addError(reference, "Every Path Point must contain valid latitude and longitude coordinates.");
    });
  });
  current.buildings.forEach((object) => {
    const reference = { type: "building" as const, id: object.id, label: label(object) };
    if (!object.name.trim()) addError(reference, "Building name is required.");
    if (!object.code.trim()) addError(reference, "Building code is required.");
    if (object.points.length < 3 || new Set(object.points.map((point) => point.join(","))).size < 3) addError(reference, "Building geometry requires at least 3 distinct points.");
    if (object.points.some((point) => !validCoordinate(point))) addError(reference, "Building geometry must use valid coordinates.");
  });

  if (campusBoundary) {
    const changedIds = new Set(
      [...groups.values()].flat().map((object) => `${object.type}:${object.id}`),
    );
    const addBoundaryError = (reference: MapObjectReference) => {
      if (changedIds.has(`${reference.type}:${reference.id}`)) {
        addError(reference, "New or modified geometry must stay inside the ISU Echague campus boundary.");
      }
    };
    current.locations.forEach((object) => {
      const reference = { type: "location" as const, id: object.id, label: label(object) };
      if (object.lat !== null && object.lng !== null && !pointOnCampus([object.lat, object.lng], campusBoundary)) addBoundaryError(reference);
    });
    current.nodes.forEach((object) => {
      const reference = { type: "node" as const, id: object.id, label: label(object) };
      if (!pointOnCampus([object.lat, object.lng], campusBoundary)) addBoundaryError(reference);
    });
    current.pathways.forEach((object) => {
      const source = current.nodes.find((node) => node.id === object.sourceNodeId);
      const destination = current.nodes.find((node) => node.id === object.destinationNodeId);
      const points = [source, ...object.pathPoints, destination]
        .filter((point): point is RouteNode | MapPoint => Boolean(point))
        .map((point) => "lat" in point ? [point.lat, point.lng] as MapPoint : point);
      const reference = { type: "pathway" as const, id: object.id, label: label(object) };
      if (!geometryOnCampus(points, campusBoundary)) addBoundaryError(reference);
    });
    current.buildings.forEach((object) => {
      const reference = { type: "building" as const, id: object.id, label: label(object) };
      if (!geometryOnCampus(object.points, campusBoundary)) addBoundaryError(reference);
    });
  }

  const order: MapChangeKind[] = ["added", "moved", "renamed", "deleted", "edited"];
  return { valid: errors.length === 0, errors, groups: order.flatMap((kind) => groups.has(kind) ? [{ kind, objects: groups.get(kind)! }] : []) };
}
