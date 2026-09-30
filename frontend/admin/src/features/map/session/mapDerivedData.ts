import { useMemo } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { geometryOnCampus, pointOnCampus, type MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import { isPositionedLocation } from "../indoorLocation/indoorLocations";
import type { PointSnapTarget } from "../pointInteractions";

interface CurrentMapObjects {
  buildings: Building[];
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
}

/** Building perimeter segments and Pathway vertices a moved or placed point snaps to. */
export function usePointSnapTargets(
  { buildings, nodes, pathways }: Pick<CurrentMapObjects, "buildings" | "nodes" | "pathways">,
  moving: { mode: EditorMode; movingId: string | null | undefined },
) {
  const { mode, movingId } = moving;
  return useMemo<PointSnapTarget[]>(() => [
    ...buildings.flatMap((building) => building.points.map((point, index) => ({
      kind: "building_perimeter" as const,
      start: point,
      end: building.points[(index + 1) % building.points.length],
    }))),
    ...pathways.flatMap((pathway) => {
      const source = nodes.find((node) => node.id === pathway.sourceNodeId);
      const destination = nodes.find((node) => node.id === pathway.destinationNodeId);
      return [
        ...(source && !(mode === "move" && source.id === movingId)
          ? [[source.lat, source.lng] as MapPoint]
          : []),
        ...pathway.pathPoints,
        ...(destination && !(mode === "move" && destination.id === movingId)
          ? [[destination.lat, destination.lng] as MapPoint]
          : []),
      ].map((point) => ({ kind: "pathway_vertex" as const, point }));
    }),
  ], [buildings, nodes, pathways, mode, movingId]);
}

/** How many current map objects lie outside the campus boundary. */
export function useOutsideBoundaryCount(
  { buildings, locations, nodes, pathways }: CurrentMapObjects,
  campusBoundary: MapPoint[],
) {
  return useMemo(() => {
    const outsideLocations = locations.filter((item) => isPositionedLocation(item) && !pointOnCampus([item.lat, item.lng], campusBoundary)).length;
    const outsideNodes = nodes.filter((item) => !pointOnCampus([item.lat, item.lng], campusBoundary)).length;
    const outsidePathways = pathways.filter((item) => {
      const source = nodes.find((node) => node.id === item.sourceNodeId);
      const destination = nodes.find((node) => node.id === item.destinationNodeId);
      return !geometryOnCampus([
        ...(source ? [[source.lat, source.lng] as [number, number]] : []),
        ...item.pathPoints,
        ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
      ], campusBoundary);
    }).length;
    const outsideBuildings = buildings.filter((item) => !geometryOnCampus(item.points, campusBoundary)).length;
    return outsideLocations + outsideNodes + outsidePathways + outsideBuildings;
  }, [campusBoundary, buildings, locations, nodes, pathways]);
}
