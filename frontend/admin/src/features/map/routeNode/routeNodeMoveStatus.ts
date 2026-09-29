import type { RouteNode } from "../../../types";
import { pointOnCampus, type MapPoint } from "../campusBoundary";
import { distanceInMeters } from "../pointInteractions";
import type { EditorMode } from "../types";
import type { useRouteNodePointTool } from "./useRouteNodePointTool";

/** How far the Route Node being moved has travelled, and whether it left the campus. */
export function routeNodeMoveStatus(
  mode: EditorMode,
  pointTool: ReturnType<typeof useRouteNodePointTool>,
  selectedNode: RouteNode | undefined,
  campusBoundary: MapPoint[],
) {
  const movingObjectName = selectedNode?.name ?? "Route Node";
  const movingOutsideBoundary = Boolean(
    mode === "move" && pointTool.position && !pointOnCampus(pointTool.position, campusBoundary),
  );
  const moveDistanceMeters = pointTool.moveOrigin && pointTool.position
    ? distanceInMeters(pointTool.moveOrigin, pointTool.position)
    : 0;
  return { movingObjectName, movingOutsideBoundary, moveDistanceMeters };
}
