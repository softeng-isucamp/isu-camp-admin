import type { Building, Location, Pathway, RouteNode } from "../../types";
import { pointInPolygon, type MapPoint } from "./campusBoundary";
import { distanceInMeters } from "./pointInteractions";

export type CanvasSelectionType = "location" | "node" | "pathway" | "building";

export interface SelectionCandidate {
  type: CanvasSelectionType;
  id: string;
  label: string;
  kindLabel: "Campus Location" | "Route Node" | "Pathway" | "Building";
}

interface SelectionCandidateCollections {
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
  buildings: Building[];
}

const HIT_RADIUS_METERS = 4;

const isNearPoint = (point: MapPoint, candidate: MapPoint) =>
  distanceInMeters(point, candidate) <= HIT_RADIUS_METERS;

const distanceToSegmentMeters = (point: MapPoint, start: MapPoint, end: MapPoint) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return distanceInMeters(point, [start[0] + ratio * dx, start[1] + ratio * dy]);
};

/**
 * Resolves every selectable domain object under a canvas click. The Map Editor
 * owns presentation; this module owns the spatial hit aggregation policy.
 */
export function findSelectionCandidates(
  point: MapPoint,
  collections: SelectionCandidateCollections,
): SelectionCandidate[] {
  const candidates: SelectionCandidate[] = [];

  collections.locations.forEach((location) => {
    if (location.lat !== null && location.lng !== null && isNearPoint(point, [location.lat, location.lng])) {
      candidates.push({ type: "location", id: location.id, label: location.name, kindLabel: "Campus Location" });
    }
  });
  collections.nodes.forEach((node) => {
    if (isNearPoint(point, [node.lat, node.lng])) {
      candidates.push({ type: "node", id: node.id, label: node.name, kindLabel: "Route Node" });
    }
  });
  collections.buildings.forEach((building) => {
    if (building.points.length >= 3 && pointInPolygon(point, building.points)) {
      candidates.push({ type: "building", id: building.id, label: building.name, kindLabel: "Building" });
    }
  });
  collections.pathways.forEach((pathway) => {
    const source = collections.nodes.find((node) => node.id === pathway.sourceNodeId);
    const destination = collections.nodes.find((node) => node.id === pathway.destinationNodeId);
    const points: MapPoint[] = [
      ...(source ? [[source.lat, source.lng] as MapPoint] : []),
      ...pathway.pathPoints,
      ...(destination ? [[destination.lat, destination.lng] as MapPoint] : []),
    ];
    if (points.some((candidate, index) => isNearPoint(point, candidate)
      || (index < points.length - 1 && distanceToSegmentMeters(point, candidate, points[index + 1]) <= HIT_RADIUS_METERS))) {
      candidates.push({ type: "pathway", id: pathway.id, label: pathway.name || "Campus Pathway", kindLabel: "Pathway" });
    }
  });

  return candidates;
}
