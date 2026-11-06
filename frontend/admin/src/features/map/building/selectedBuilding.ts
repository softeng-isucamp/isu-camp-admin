import type { Building, Location, RouteNode } from "../../../types";

/** The selected Building with the Campus Location, entrances, and routability derived for it. */
export interface SelectedBuildingView {
  building: Building;
  location: Location | undefined;
  /** Location id when the Building has one, otherwise the Building id. */
  associationId: string;
  entrances: RouteNode[];
  routable: boolean;
}

/** Why a Building cannot be routed to; the checks run in this order. */
export type UnroutableReason = "no_footprint" | "inactive" | "no_entrance" | "entrances_unusable";

/** An entrance a walker can use: finite coordinates and not Inactive. */
export const isUsableEntrance = (node: RouteNode): boolean =>
  Number.isFinite(node.lat) && Number.isFinite(node.lng) && (node.status ? node.status === "Active" : true);

/** The first reason the Building is not routable, or null when it is. One rule shared by routability and its explanation. */
export function unroutableReasonFor(building: Building, location: Location | undefined, entrances: RouteNode[]): UnroutableReason | null {
  if (building.points.length < 3) return "no_footprint";
  if ((location ? location.status : (building.status ?? "Active")) !== "Active") return "inactive";
  if (entrances.some(isUsableEntrance)) return null;
  return entrances.length ? "entrances_unusable" : "no_entrance";
}

/** Derives the view of the selected Building from the current Locations, and Route Nodes. */
export function selectedBuildingViewFor(
  selectedBuilding: Building | undefined,
  locations: Location[],
  nodes: RouteNode[],
): SelectedBuildingView | null {
  if (!selectedBuilding) return null;
  const location = locations.find((candidate) =>
    candidate.type === "Place"
      && (candidate.id === selectedBuilding.id || candidate.name === selectedBuilding.name));
  const associationId = location?.id ?? selectedBuilding.id;
  const entrances = nodes.filter((node) => node.nodeType === "Entrance" && (node.associatedPlaceId === selectedBuilding.id || node.associatedPlaceId === associationId));
  const routable = unroutableReasonFor(selectedBuilding, location, entrances) === null;
  return { building: selectedBuilding, location, associationId, entrances, routable };
}
