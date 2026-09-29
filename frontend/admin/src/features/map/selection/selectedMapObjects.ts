import type { LocalMapFeatureEntity } from "../../../services/mapLayers";
import type { Building, Location, RouteNode } from "../../../types";
import type { MapSelection } from "./useMapSelection";

/**
 * The objects a selection refers to. IDs are scoped to an entity type: a
 * Pathway and an Indoor Location may legitimately share a database ID, so
 * every derived selection must cross the typed identity seam rather than
 * matching only the ID.
 */
export function selectedMapObjects(
  selected: MapSelection | null,
  current: {
    contentLocations: Location[];
    nodes: RouteNode[];
    buildings: Building[];
    localFeatures: LocalMapFeatureEntity[];
  },
) {
  const location = selected?.type === "location"
    ? current.contentLocations.find((item) => item.id === selected.id)
    : undefined;
  const node = selected?.type === "node"
    ? current.nodes.find((item) => item.id === selected.id)
    : undefined;
  const building = selected?.type === "building"
    ? current.buildings.find((item) => item.id === selected.id)
    : undefined;
  const localFeature = selected?.type === "local_feature"
    ? current.localFeatures.find((item) => item.id === selected.id)
    : undefined;
  return { location, node, building, localFeature };
}
