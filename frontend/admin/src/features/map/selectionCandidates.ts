import type { ReactNode } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import type { MapPoint } from "./campusBoundary";

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

/**
 * Finds selection candidates near a given anchor point.
 * Used for disambiguation when multiple objects are near a click location.
 */
export function findSelectionCandidates(
  anchor: MapPoint,
  collections: SelectionCandidatesInput
): SelectionCandidate[] {
  const candidates: SelectionCandidate[] = [];
  const maxDistance = 0.01; // Approximate search radius in degrees

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
        kindLabel: node.nodeType,
        distance,
      });
    }
  });

  // Search pathways (by proximity to path points)
  collections.pathways.forEach((pathway) => {
    for (const point of pathway.pathPoints) {
      const distance = Math.hypot(point[0] - anchor[0], point[1] - anchor[1]);
      if (distance < maxDistance) {
        candidates.push({
          id: pathway.id,
          type: "pathway",
          label: pathway.name,
          kindLabel: "Pathway",
          distance,
        });
        break; // Only add once per pathway
      }
    }
  });

  // Search buildings (by proximity to vertices)
  collections.buildings.forEach((building) => {
    for (const point of building.points) {
      const distance = Math.hypot(point[0] - anchor[0], point[1] - anchor[1]);
      if (distance < maxDistance) {
        candidates.push({
          id: building.id,
          type: "building",
          label: building.name,
          kindLabel: "Building",
          distance,
        });
        break; // Only add once per building
      }
    }
  });

  // Sort by distance and return
  return candidates.sort((a, b) => a.distance - b.distance);
}
