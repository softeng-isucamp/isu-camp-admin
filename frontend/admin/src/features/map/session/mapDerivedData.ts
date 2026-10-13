import { useMemo } from "react";
import type { Building, Pathway, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import type { PointSnapTarget } from "../pointInteractions";

/** Building perimeter segments and Pathway vertices a moved or placed point snaps to. */
export function usePointSnapTargets(
  { buildings, nodes, pathways }: { buildings: Building[]; nodes: RouteNode[]; pathways: Pathway[] },
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
