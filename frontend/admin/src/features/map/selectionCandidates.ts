import type { ReactNode } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { pointInPolygon, type MapPoint } from "./campusBoundary";

export type CanvasSelectionType = "location" | "node" | "pathway" | "building";

export interface SelectionCandidate {
  id: string;
  type: CanvasSelectionType;
  label: string;
  kindLabel: string;
  distance: number;
}

interface SelectionCandidatesInput {
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
  buildings: Building[];
}

const distanceToSegment = (point: MapPoint, start: MapPoint, end: MapPoint) => {
  const latitudeDelta = end[0] - start[0];
  const longitudeDelta = end[1] - start[1];
  const lengthSquared = latitudeDelta ** 2 + longitudeDelta ** 2;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * latitudeDelta + (point[1] - start[1]) * longitudeDelta) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (start[0] + projection * latitudeDelta),
    point[1] - (start[1] + projection * longitudeDelta),
  );
};

/**
 * Finds selection candidates near a given anchor point.
 * Used for disambiguation when multiple objects are near a click location.
 */
export function findSelectionCandidates(
  anchor: MapPoint,
  collections: SelectionCandidatesInput
): SelectionCandidate[] {
  const candidates: SelectionCandidate[] = [];
  const maxDistance = 0.00005; // Approximate search radius in degrees (~5 meters)

  // Search locations
  collections.locations.forEach((location) => {
    if (location.lat !== null && location.lng !== null) {
      const distance = Math.hypot(location.lat - anchor[0], location.lng - anchor[1]);
      if (distance < maxDistance) {
        candidates.push({
          id: location.id,
          type: "location",
          label: location.name,
          kindLabel: location.type,
          distance,
        });
      }
    }
  });

  // Search nodes
  collections.nodes.forEach((node) => {
    const distance = Math.hypot(node.lat - anchor[0], node.lng - anchor[1]);
    if (distance < maxDistance) {
      candidates.push({
        id: node.id,
        type: "node",
        label: node.name,
        kindLabel: "Route Node",
        distance,
      });
    }
  });

  // Search pathways by proximity to their complete rendered geometry.
  collections.pathways.forEach((pathway) => {
    const source = collections.nodes.find((node) => node.id === pathway.sourceNodeId);
    const destination = collections.nodes.find((node) => node.id === pathway.destinationNodeId);
    const geometry: MapPoint[] = [
      ...(source ? [[source.lat, source.lng] as MapPoint] : []),
      ...pathway.pathPoints,
      ...(destination ? [[destination.lat, destination.lng] as MapPoint] : []),
    ];
    const distances = geometry.slice(1).map((point, index) => distanceToSegment(anchor, geometry[index], point));
    const distance = distances.length > 0
      ? Math.min(...distances)
      : geometry.length === 1 ? Math.hypot(geometry[0][0] - anchor[0], geometry[0][1] - anchor[1]) : Infinity;
    if (distance < maxDistance) {
      candidates.push({
        id: pathway.id,
        type: "pathway",
        label: pathway.name,
        kindLabel: "Pathway",
        distance,
      });
    }
  });

  // Search buildings by footprint containment or proximity to an edge.
  collections.buildings.forEach((building) => {
    const edgeDistances = building.points.map((point, index) =>
      distanceToSegment(anchor, point, building.points[(index + 1) % building.points.length]),
    );
    const distance = pointInPolygon(anchor, building.points)
      ? 0
      : edgeDistances.length > 0 ? Math.min(...edgeDistances) : Infinity;
    if (distance < maxDistance) {
      candidates.push({
        id: building.id,
        type: "building",
        label: building.name,
        kindLabel: "Building",
        distance,
      });
    }
  });

  // Sort by distance and return
  return candidates.sort((a, b) => a.distance - b.distance);
}
