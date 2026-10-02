import type { Building, Pathway, RouteNode } from "../../../types";

const buildingFor = (node: RouteNode, buildings: readonly Building[]) => node.associatedPlaceId ? buildings.find((building) => building.id === node.associatedPlaceId) : undefined;

/** The hard-delete UI needs impact information, not a lifecycle transition. */
export interface DeleteImpact {
  connectedPathways: Pathway[];
  affectedEntrances: RouteNode[];
  affectedBuildings: Building[];
}

export function calculateDeleteImpact(input: {
  object: Pathway | RouteNode;
  pathways: readonly Pathway[];
  nodes: readonly RouteNode[];
  buildings: readonly Building[];
}): DeleteImpact {
  const isPathway = "sourceNodeId" in input.object;
  const connectedPathways = isPathway
    ? [input.object as Pathway]
    : input.pathways.filter((pathway) => pathway.sourceNodeId === input.object.id || pathway.destinationNodeId === input.object.id);
  const affectedEntrances = input.nodes.filter((node) => node.nodeType === "Entrance" && (
    node.id === input.object.id
    || connectedPathways.some((pathway) => pathway.sourceNodeId === node.id || pathway.destinationNodeId === node.id)
  ));
  const affectedBuildings = affectedEntrances
    .map((node) => buildingFor(node, input.buildings))
    .filter((building): building is Building => Boolean(building));
  return { connectedPathways, affectedEntrances, affectedBuildings };
}
