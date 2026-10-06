import type L from "leaflet";
import { PATHWAY_ALLOWED_MODES, splitPathwayWayTypes, type Building, type Location, type Pathway, type RouteNode } from "../../types";
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
  const ring = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1)
    : points;
  if (ring.length < 3) return polygonCentroid(ring);
  const origin = ring[0];
  const translated = ring.map(([lat, lng]) => [lat - origin[0], lng - origin[1]] as MapPoint);
  let twiceArea = 0;
  let latitude = 0;
  let longitude = 0;
  translated.forEach((point, index) => {
    const next = translated[(index + 1) % translated.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    twiceArea += cross;
    latitude += (point[0] + next[0]) * cross;
    longitude += (point[1] + next[1]) * cross;
  });
  if (Math.abs(twiceArea) < Number.EPSILON) return polygonCentroid(ring);
  const areaPoint: MapPoint = [origin[0] + latitude / (3 * twiceArea), origin[1] + longitude / (3 * twiceArea)];
  if (pointInPolygon(areaPoint, ring)) return areaPoint;
  const lats = ring.map(([lat]) => lat); const lngs = ring.map(([, lng]) => lng);
  const south = Math.min(...lats); const north = Math.max(...lats);
  const west = Math.min(...lngs); const east = Math.max(...lngs);
  let best: MapPoint | null = null; let bestClearance = -1;
  const distanceToEdges = (candidate: MapPoint) => Math.min(...ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    const dx = next[0] - point[0]; const dy = next[1] - point[1];
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared ? Math.max(0, Math.min(1, ((candidate[0] - point[0]) * dx + (candidate[1] - point[1]) * dy) / lengthSquared)) : 0;
    const nearest: MapPoint = [point[0] + projection * dx, point[1] + projection * dy];
    return Math.hypot(candidate[0] - nearest[0], candidate[1] - nearest[1]);
  }));
  for (let row = 0; row <= 32; row += 1) for (let column = 0; column <= 32; column += 1) {
    const candidate: MapPoint = [south + (north - south) * row / 32, west + (east - west) * column / 32];
    if (!pointInPolygon(candidate, ring)) continue;
    const clearance = distanceToEdges(candidate);
    if (clearance > bestClearance) { best = candidate; bestClearance = clearance; }
  }
  return best ?? ring[0];
};

/** Builds the default human-facing label for a Pathway from its endpoints. */
export const suggestedPathwayName = (
  pathway: Pick<Pathway, "sourceNodeId" | "destinationNodeId">,
  nodes: readonly RouteNode[],
): string => {
  const endpointNames = [pathway.sourceNodeId, pathway.destinationNodeId]
    .map((nodeId) => nodes.find((node) => node.id === nodeId)?.name.trim() ?? "")
    .filter(Boolean);
  if (endpointNames.length !== 2) return "";
  return endpointNames.sort((left, right) => left.localeCompare(right)).join(" – ");
};

/** Applies the endpoint suggestion only when the administrator left the name blank. */
export const pathwayWithSuggestedName = (pathway: Pathway, nodes: readonly RouteNode[]): Pathway =>
  pathway.name.trim() ? pathway : { ...pathway, name: suggestedPathwayName(pathway, nodes) };


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

export interface PathwayDraftIssue {
  field: "name" | "type" | "direction" | "status" | "allowedModes" | "pathPoint" | "sequence";
  message: string;
}

export interface RouteNodeDraftIssue {
  field: "name" | "nodeType" | "coordinate" | "association";
  message: string;
}

const routeNodeTypes: RouteNode["nodeType"][] = ["Entrance", "Junction", "Access Point"];

/** Local checks shared by placement, editing, and the final draft review. */
export function validateRouteNodeDraft(
  node: RouteNode,
  input: {
    buildings: readonly Building[];
    locations?: readonly Location[];
    campusBoundary?: MapPoint[];
  },
): RouteNodeDraftIssue[] {
  const issues: RouteNodeDraftIssue[] = [];
  if (!node.name.trim()) issues.push({ field: "name", message: "Route Node name is required." });
  if (!routeNodeTypes.includes(node.nodeType)) issues.push({ field: "nodeType", message: "Route Node type is required." });
  if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng) || node.lat < -90 || node.lat > 90 || node.lng < -180 || node.lng > 180) {
    issues.push({ field: "coordinate", message: "Route Node latitude and longitude must be valid finite coordinates." });
  } else if (input.campusBoundary && !pointOnCampus([node.lat, node.lng], input.campusBoundary)) {
    issues.push({ field: "coordinate", message: "The Route Node must be inside the ISU Echague campus boundary." });
  }
  if (node.associatedPlaceId && node.nodeType !== "Entrance") {
    issues.push({ field: "association", message: "Only Entrance Route Nodes may have a Building association." });
  } else if (node.associatedPlaceId) {
    const buildingIds = new Set(input.buildings.map((building) => building.id));
    input.locations?.filter((location) => location.type === "Building" || location.type === "Facility").forEach((location) => buildingIds.add(location.id));
    if (!buildingIds.has(node.associatedPlaceId)) {
      issues.push({ field: "association", message: "Associated Building does not exist." });
    }
  }
  return issues;
}

export interface PathwayDraftValidationOptions {
  /** Existing pathways are used to prevent a second physical connection. */
  existingPathways?: readonly Pathway[];
  /** New and edited Pathways must connect active Route Nodes. */
  requireActiveEndpoints?: boolean;
}

/** Local, synchronous checks used by the parent-frame Pathway editor. */
export function validatePathwayDraft(
  pathway: Pathway,
  nodes: readonly RouteNode[],
  campusBoundary?: MapPoint[],
  options: PathwayDraftValidationOptions = {},
): PathwayDraftIssue[] {
  const issues: PathwayDraftIssue[] = [];
  if (!pathway.name.trim()) issues.push({ field: "name", message: "Pathway name is required." });
  const wayTypes = splitPathwayWayTypes(pathway.type);
  if (!pathway.type.trim()) issues.push({ field: "type", message: "Way type is required." });
  else if (!wayTypes.length) {
    issues.push({ field: "type", message: "Way type must be Walkway, Road, or both." });
  }
  if (pathway.direction !== "Two-way" && pathway.direction !== "One-way") issues.push({ field: "direction", message: "Pathway direction must be Two-way or One-way." });
  if (pathway.status !== "Active" && pathway.status !== "Open" && pathway.status !== "Closed") issues.push({ field: "status", message: "Pathway status must be Active or Closed." });
  const allowedModes = pathway.allowedModes ?? ["Walking"];
  if (!allowedModes.length || allowedModes.some((mode) => !PATHWAY_ALLOWED_MODES.includes(mode))) {
    issues.push({ field: "allowedModes", message: "Choose Walking, Vehicle, or both Allowed modes." });
  }
  if (wayTypes.length && !wayTypes.includes("Road") && allowedModes.includes("Vehicle")) {
    issues.push({ field: "allowedModes", message: "Walkways cannot allow Vehicle mode." });
  }
  const source = nodes.find((node) => node.id === pathway.sourceNodeId);
  const destination = nodes.find((node) => node.id === pathway.destinationNodeId);
  if (!source || !destination) issues.push({ field: "sequence", message: "Pathway endpoints must reference existing Route Nodes." });
  if (source && destination && source.id === destination.id) issues.push({ field: "sequence", message: "Pathway endpoints must be distinct; self-links are not allowed." });
  if (options.requireActiveEndpoints && source && destination
    && (source.status !== undefined && source.status !== "Active" || destination.status !== undefined && destination.status !== "Active")) {
    issues.push({ field: "sequence", message: "Pathway endpoints must reference active Route Nodes." });
  }
  const duplicate = options.existingPathways?.find((candidate) =>
    candidate.id !== pathway.id
      && candidate.sourceNodeId !== candidate.destinationNodeId
      && pathway.sourceNodeId !== pathway.destinationNodeId
      && [candidate.sourceNodeId, candidate.destinationNodeId].sort().join("::")
        === [pathway.sourceNodeId, pathway.destinationNodeId].sort().join("::"),
  );
  if (duplicate) {
    issues.push({ field: "sequence", message: `Pathway duplicates the physical connection already used by ${duplicate.name}.` });
  }
  pathway.pathPoints.forEach(([latitude, longitude], index) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      issues.push({ field: "pathPoint", message: `Path Point #${index + 1} must use a valid latitude and longitude.` });
    }
  });
  for (let index = 1; index < pathway.pathPoints.length; index += 1) {
    if (pathway.pathPoints[index - 1][0] === pathway.pathPoints[index][0]
      && pathway.pathPoints[index - 1][1] === pathway.pathPoints[index][1]) {
      issues.push({ field: "sequence", message: `Path Sequence contains duplicate consecutive points at #${index} and #${index + 1}.` });
      break;
    }
  }
  if (campusBoundary && source && destination) {
    const coordinates: MapPoint[] = [[source.lat, source.lng], ...pathway.pathPoints, [destination.lat, destination.lng]];
    if (!geometryOnCampus(coordinates, campusBoundary)) {
      issues.push({ field: "sequence", message: "The Path Sequence must stay inside the ISU Echague campus boundary." });
    }
  }
  return issues;
}

export const isPointInBounds = (
  lat: number,
  lng: number,
  bounds: L.LatLngBounds | null,
  margin = 0.002
) => {
  if (!bounds || typeof bounds.getSouth !== "function") return true;
  const south = bounds.getSouth() - margin;
  const north = bounds.getNorth() + margin;
  const west = bounds.getWest() - margin;
  const east = bounds.getEast() + margin;
  return lat >= south && lat <= north && lng >= west && lng <= east;
};

export const overlayChanges = <T extends { id: string }>(original: T[], changed: T[]) => {
  const changes = new Map(changed.map((item) => [item.id, item]));
  return original.map((item) => changes.get(item.id) ?? item).concat(changed.filter((item) => !original.some((candidate) => candidate.id === item.id)));
};
