import { useState } from "react";
import type { Building, Location, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import type { RouteNodeWorkflow } from "../routeNode/RouteNodeWorkflow";
import type { SelectedBuildingView } from "./selectedBuilding";

interface UseEntranceLinkingOptions {
  workflow: RouteNodeWorkflow;
  context: { buildings: Building[]; locations: Location[]; campusBoundary: MapPoint[] };
  onNodeSaved: (node: RouteNode) => void;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
  /** The Entrance was linked; the caller re-selects the Building. */
  onLinked: (buildingId: string) => void;
}

/** Linking an existing Route Node to the selected Building as an Entrance. */
export function useEntranceLinking({
  workflow,
  context,
  onNodeSaved,
  refreshMapData,
  onError,
  onLinked,
}: UseEntranceLinkingOptions) {
  const [linking, setLinking] = useState(false);

  const linkExistingEntrance = async (view: SelectedBuildingView, node: RouteNode) => {
    const building = view.building;
    const updated = { ...node, nodeType: "Entrance" as const, associatedPlaceId: view.associationId };
    const result = await workflow.finalize({
      kind: "update",
      before: node,
      after: updated,
      context,
      description: `Link ${node.name} to ${building.name}`,
    });
    if (!result.ok) {
      onError(result.message);
      return;
    }
    try {
      onNodeSaved(result.node);
      await refreshMapData();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "The Entrance association was saved, but the map could not refresh.");
      return;
    }
    setLinking(false);
    onLinked(building.id);
  };

  return { linking, setLinking, linkExistingEntrance };
}
