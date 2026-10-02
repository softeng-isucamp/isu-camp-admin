import type { Building, Location, RouteNode } from "../../../types";
import type { MapSelection } from "./useMapSelection";

/**
 * The objects a selection refers to. IDs are scoped to an entity type: for
 * example, a Building and an Indoor Location may share a database ID, so a
 * Location selection must preserve its subtype as well as its ID.
 */
export function selectedMapObjects(
  selected: MapSelection | null,
  current: {
    contentLocations: Location[];
    nodes: RouteNode[];
    buildings: Building[];
  },
) {
  const location = selected?.type === "location"
    ? current.contentLocations.find((item) => item.id === selected.id && item.type === selected.locationType)
    : undefined;
  const node = selected?.type === "node"
    ? current.nodes.find((item) => item.id === selected.id)
    : undefined;
  const building = selected?.type === "building"
    ? current.buildings.find((item) => item.id === selected.id)
    : undefined;
  return { location, node, building };
}
