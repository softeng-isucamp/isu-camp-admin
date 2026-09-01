import type { Pathway, RouteNode } from "../../types";
import type { WorkingOperation } from "./types";

export interface RouteNodeDeactivation {
  node: RouteNode;
  pathways: Pathway[];
  operations: WorkingOperation[];
}

/** Builds the atomic graph change required when a Route Node is deactivated. */
export function deactivateRouteNode(
  node: RouteNode,
  connectedPathways: Pathway[],
): RouteNodeDeactivation {
  const inactiveNode = { ...node, status: "Inactive" as const };
  return {
    node: inactiveNode,
    pathways: connectedPathways,
    operations: [
      {
        id: `deactivate-${node.id}`,
        type: "retire_entity",
        domain: "Routes & Paths",
        entityId: node.id,
        before: node as unknown as Record<string, unknown>,
        after: inactiveNode as unknown as Record<string, unknown>,
        description: `Deactivate ${node.name}`,
      },
      ...connectedPathways.map((pathway) => {
        return {
          id: `retire-${pathway.id}`,
          type: "retire_entity" as const,
          domain: "Routes & Paths" as const,
          entityId: pathway.id,
          before: pathway as unknown as Record<string, unknown>,
          after: null,
          description: `Remove ${pathway.name} after deactivating ${node.name}`,
        };
      }),
    ],
  };
}
