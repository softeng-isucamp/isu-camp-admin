import { useMemo } from "react";
import { normalizeMapLayers } from "../../../services/mapLayers";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { useLocalFeatureLayer } from "./useLocalFeatureLayer";

/** The Local Map Features of the current map objects, with this session's feature changes applied. */
export function useCurrentLocalFeatures(
  layer: ReturnType<typeof useLocalFeatureLayer>,
  current: { buildings: Building[]; locations: Location[]; nodes: RouteNode[]; pathways: Pathway[] },
) {
  const { buildings, locations, nodes, pathways } = current;
  const normalizedLocalFeatures = useMemo(
    () => normalizeMapLayers({
      buildings,
      locations,
      routeNodes: nodes,
      pathways,
    }).localFeatures,
    [buildings, locations, nodes, pathways],
  );
  return useMemo(
    () => layer.withFeatureChanges(normalizedLocalFeatures),
    [layer.withFeatureChanges, normalizedLocalFeatures],
  );
}
