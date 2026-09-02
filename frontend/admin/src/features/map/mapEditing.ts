import type { Building, Location, Pathway, RouteNode } from "../../types";
import { locationPolicy } from "../../lib/locationPolicy";
import { geometryOnCampus, pointInPolygon, pointOnCampus, type MapPoint } from "./campusBoundary";

export const polygonCentroid = (points: MapPoint[]): MapPoint => points.length
  ? [points.reduce((sum, [lat]) => sum + lat, 0) / points.length, points.reduce((sum, [, lng]) => sum + lng, 0) / points.length]
  : [0, 0];

/** Returns true when two non-adjacent polygon edges cross or overlap. */
export const polygonSelfIntersects = (points: MapPoint[]): boolean => {
  const ring = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1)
    : points;
  if (ring.length < 4) return false;
  const orientation = (a: MapPoint, b: MapPoint, c: MapPoint) => {
    const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return Math.abs(value) < Number.EPSILON ? 0 : value > 0 ? 1 : 2;
  };
  const onSegment = (a: MapPoint, b: MapPoint, c: MapPoint) =>
    Math.min(a[0], c[0]) <= b[0] && b[0] <= Math.max(a[0], c[0])
    && Math.min(a[1], c[1]) <= b[1] && b[1] <= Math.max(a[1], c[1]);
  const intersects = (a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) => {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    if (abC !== abD && cdA !== cdB) return true;
    return (abC === 0 && onSegment(a, c, b)) || (abD === 0 && onSegment(a, d, b))
      || (cdA === 0 && onSegment(c, a, d)) || (cdB === 0 && onSegment(c, b, d));
  };
  for (let first = 0; first < ring.length; first += 1) {
    const firstEnd = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondEnd = (second + 1) % ring.length;
      if (first === second || firstEnd === second || secondEnd === first) continue;
      if (intersects(ring[first], ring[firstEnd], ring[second], ring[secondEnd])) return true;
    }
  }
  return false;
};

/** A polygon needs three distinct vertices and measurable area. */
export const polygonIsNonDegenerate = (points: MapPoint[]): boolean => {
  const ring = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1)
    : points;
  if (ring.length < 3 || new Set(ring.map((point) => point.join(","))).size < 3) return false;
  const twiceArea = ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return Math.abs(twiceArea) > Number.EPSILON;
};

/** Translates every vertex by the same latitude/longitude delta. */
export const translatePolygon = (points: MapPoint[], delta: MapPoint): MapPoint[] =>
  points.map(([lat, lng]) => [lat + delta[0], lng + delta[1]]);

/** Area-weighted centroid used for internal labels and routing anchors. */
export const polygonFeatureAnchor = (points: MapPoint[]): MapPoint => {
  if (points.length < 3) return polygonCentroid(points);
  let twiceArea = 0;
  let latitude = 0;
  let longitude = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    twiceArea += cross;
    latitude += (point[0] + next[0]) * cross;
    longitude += (point[1] + next[1]) * cross;
  });
  if (Math.abs(twiceArea) < Number.EPSILON) return polygonCentroid(points);
  const areaPoint: MapPoint = [latitude / (3 * twiceArea), longitude / (3 * twiceArea)];
  if (pointInPolygon(areaPoint, points)) return areaPoint;
  const lats = points.map(([lat]) => lat); const lngs = points.map(([, lng]) => lng);
  const south = Math.min(...lats); const north = Math.max(...lats);
  const west = Math.min(...lngs); const east = Math.max(...lngs);
  let best: MapPoint | null = null; let bestClearance = -1;
  const distanceToEdges = (candidate: MapPoint) => Math.min(...points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next[0] - point[0]; const dy = next[1] - point[1];
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared ? Math.max(0, Math.min(1, ((candidate[0] - point[0]) * dx + (candidate[1] - point[1]) * dy) / lengthSquared)) : 0;
    const nearest: MapPoint = [point[0] + projection * dx, point[1] + projection * dy];
    return Math.hypot(candidate[0] - nearest[0], candidate[1] - nearest[1]);
  }));
  for (let row = 0; row <= 32; row += 1) for (let column = 0; column <= 32; column += 1) {
    const candidate: MapPoint = [south + (north - south) * row / 32, west + (east - west) * column / 32];
    if (!pointInPolygon(candidate, points)) continue;
    const clearance = distanceToEdges(candidate);
    if (clearance > bestClearance) { best = candidate; bestClearance = clearance; }
  }
  return best ?? areaPoint;
};

/** Returns true when polygon vertices are not collinear (non-degenerate). */
export const polygonIsNonDegenerate = (points: MapPoint[]): boolean => {
  if (points.length < 3) return false;
  // Check if all points are collinear using cross product
  const [p0, p1] = [points[0], points[1]];
  // Use first two points to define a line
  for (let i = 2; i < points.length; i++) {
    const p = points[i];
    // Cross product: (p1 - p0) × (p - p0)
    const cross = (p1[0] - p0[0]) * (p[1] - p0[1]) - (p1[1] - p0[1]) * (p[0] - p0[0]);
    if (Math.abs(cross) > Number.EPSILON) {
      // Found a non-collinear point
      return true;
    }
  }
  return false;
};

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

/** Keep pathway endpoints relationally owned by the Route Nodes collection.
 * Endpoint coordinates are rendered from those nodes and must not also be
 * persisted as intermediate Path Points.
 */
export const withoutEndpointPathPoints = (
  points: [number, number][],
  source: [number, number],
  destination: [number, number],
): [number, number][] => points.filter(([lat, lng]) =>
  !([source, destination] as [number, number][]).some(([endpointLat, endpointLng]) =>
    lat === endpointLat && lng === endpointLng,
  ),
);

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
    const locationEvaluation = locationPolicy.evaluate(object, {
      context: "map-readiness",
      directory: current.locations,
    });
    locationEvaluation.issues.forEach((issue) => addError(reference, issue.message));
  });
  current.nodes.forEach((object) => {
    const reference = { type: "node" as const, id: object.id, label: label(object) };
    if (!object.name.trim()) addError(reference, "Route Node name is required.");
    if (!object.nodeType) addError(reference, "Route Node type is required.");
    if (!validCoordinate([object.lat, object.lng])) addError(reference, "Route Node latitude and longitude must be valid coordinates.");
    if (object.associatedPlaceId && !locationIds.has(object.associatedPlaceId)) addError(reference, "Associated Building does not exist.");
    if (object.associatedPlaceId) {
      const associated = current.locations.find((location) => location.id === object.associatedPlaceId);
      // Legacy map fixtures may use a Facility-shaped association. Enforce the
      // canonical Building boundary once the associated network Building exists.
      if (associated && associated.type !== "Building" && current.buildings.some((building) => building.id === associated.id)) addError(reference, "Entrance Route Nodes may only be associated with a Building.");
      if (object.nodeType !== "Entrance") addError(reference, "Only Entrance Route Nodes may have a Building association.");
    }
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
    if (polygonSelfIntersects(object.points)) addError(reference, "Building geometry contains self-intersecting edges.");
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
