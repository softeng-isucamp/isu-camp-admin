import type { FeatureLinkEntity } from "../../../services/mapLayers";
import type { Building, Location, RouteNode } from "../../../types";

/** The selected Building with the Campus Location, entrances, and routability derived for it. */
export interface SelectedBuildingView {
  building: Building;
  location: Location | undefined;
  /** Location id when the Building has one, otherwise the Building id. */
  associationId: string;
  entrances: RouteNode[];
  hasFootprint: boolean;
  routable: boolean;
}

/** Derives the view of the selected Building from the current Locations, Route Nodes, and Feature Links. */
export function selectedBuildingViewFor(
  selectedBuilding: Building | undefined,
  locations: Location[],
  nodes: RouteNode[],
  featureLinks: FeatureLinkEntity[],
): SelectedBuildingView | null {
  if (!selectedBuilding) return null;
  const location = locations.find((candidate) =>
    (candidate.type === "Building" || candidate.type === "Facility")
      && (candidate.id === selectedBuilding.id || candidate.name === selectedBuilding.name));
  const associationId = location?.id ?? selectedBuilding.id;
  const entrances = nodes.filter((node) => node.nodeType === "Entrance" && (node.associatedPlaceId === selectedBuilding.id || node.associatedPlaceId === associationId));
  const hasFootprint = Boolean(
    selectedBuilding.points.length >= 3 ||
    featureLinks.some((link) => link.targetEntityId === selectedBuilding.id && link.linkType === "building_footprint"),
  );
  const routable = Boolean(
    hasFootprint &&
    (location ? location.status === "Active" : (selectedBuilding.status ?? "Active") === "Active") &&
    entrances.some((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng) && (node.status ? node.status === "Active" : true)),
  );
  return { building: selectedBuilding, location, associationId, entrances, hasFootprint, routable };
}
