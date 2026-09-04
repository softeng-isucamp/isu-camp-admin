import type { Pathway, RouteNode } from "../../types";
import type { WorkingOperation } from "./types";
import { createJunctionSplit, type GeographicCoordinate } from "./pathwayTopology";

export function createRoutableCrossing(
  pathwayA: Pathway,
  pathwayB: Pathway,
  nodes: RouteNode[],
  point: GeographicCoordinate,
  junctionId: string,
): {
  junction: RouteNode;
  closedPathways: [Pathway, Pathway];
  replacementPathways: [Pathway, Pathway, Pathway, Pathway];
  operations: WorkingOperation[];
} {
  const splitA = createJunctionSplit(pathwayA, nodes, point, junctionId);
  const splitB = createJunctionSplit(pathwayB, nodes, point, junctionId);
  const junction = splitA.junction;
  const closedPathways: [Pathway, Pathway] = [
    { ...pathwayA, status: "Closed" },
    { ...pathwayB, status: "Closed" },
  ];
  const replacementPathways: [Pathway, Pathway, Pathway, Pathway] = [
    ...splitA.pathways,
    ...splitB.pathways,
  ];
  const operations: WorkingOperation[] = [
    {
      id: `create-${junctionId}`,
      type: "create_entity",
      domain: "Walking Network",
      entityId: junctionId,
      before: null,
      after: junction as unknown as Record<string, unknown>,
      description: `Create ${junction.name}`,
    },
    ...closedPathways.flatMap((closedPathway, index) => {
      const original = index === 0 ? pathwayA : pathwayB;
      const replacements = index === 0 ? splitA.pathways : splitB.pathways;
      return [
        {
          id: `close-${original.id}`,
          type: "retire_entity" as const,
          domain: "Walking Network" as const,
          entityId: original.id,
          before: original as unknown as Record<string, unknown>,
          after: closedPathway as unknown as Record<string, unknown>,
          description: `Replace ${original.name} with split Pathways`,
        },
        ...replacements.map((replacement) => ({
          id: `create-${replacement.id}`,
          type: "create_entity" as const,
          domain: "Walking Network" as const,
          entityId: replacement.id,
          before: null,
          after: replacement as unknown as Record<string, unknown>,
          description: `Create ${replacement.name}`,
        })),
      ];
    }),
  ];
  return { junction, closedPathways, replacementPathways, operations };
}
