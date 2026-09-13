import type { Building, Location, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import { validateRouteNodeDraft, type RouteNodeDraftIssue } from "../mapEditing";
import type { WorkingOperation } from "../types";
import { WorkingSessionManager } from "../WorkingSessionManager";

export interface RouteNodeValidationContext {
  buildings: readonly Building[];
  locations?: readonly Location[];
  campusBoundary?: MapPoint[];
}

export type RouteNodeFinalizeCommand =
  | {
      kind: "create";
      draft: Omit<RouteNode, "id">;
      context: RouteNodeValidationContext;
      description?: string;
    }
  | {
      kind: "update";
      before: RouteNode;
      after: RouteNode;
      context: RouteNodeValidationContext;
      description?: string;
    };

export type RouteNodeFinalizeResult =
  | { ok: true; node: RouteNode; operation: WorkingOperation }
  | {
      ok: false;
      reason: "validation" | "persistence" | "stale";
      message: string;
      issues?: RouteNodeDraftIssue[];
    };

export interface RouteNodeWriteAdapter {
  createRouteNode(node: Omit<RouteNode, "id">): Promise<RouteNode>;
  updateRouteNode(node: RouteNode): Promise<RouteNode>;
}

export interface RouteNodeWorkflow {
  finalize(command: RouteNodeFinalizeCommand): Promise<RouteNodeFinalizeResult>;
}

const geometryOnlyChanged = (before: RouteNode, after: RouteNode) => {
  const { lat: _beforeLat, lng: _beforeLng, ...beforeProperties } = before;
  const { lat: _afterLat, lng: _afterLng, ...afterProperties } = after;
  return (before.lat !== after.lat || before.lng !== after.lng)
    && JSON.stringify(beforeProperties) === JSON.stringify(afterProperties);
};

export function createRouteNodeWorkflow(dependencies: {
  adapter: RouteNodeWriteAdapter;
  workingSession: WorkingSessionManager;
}): RouteNodeWorkflow {
  const { adapter, workingSession } = dependencies;

  return {
    async finalize(command) {
      if (command.kind === "update" && command.before.id !== command.after.id) {
        return {
          ok: false,
          reason: "stale",
          message: "This Route Node draft no longer matches the selected Route Node.",
        };
      }

      const candidate: RouteNode = command.kind === "create"
        ? { ...command.draft, id: "pending-route-node" }
        : command.after;
      const issues = validateRouteNodeDraft(candidate, command.context);
      if (issues.length > 0) {
        return {
          ok: false,
          reason: "validation",
          message: issues[0].message,
          issues,
        };
      }

      try {
        const node = command.kind === "create"
          ? await adapter.createRouteNode(command.draft)
          : await adapter.updateRouteNode(command.after);
        const operation = workingSession.executeOperation({
          type: command.kind === "create"
            ? "create_entity"
            : geometryOnlyChanged(command.before, node)
              ? "update_geometry"
              : "update_properties",
          domain: "Walking Network",
          entityId: node.id,
          before: command.kind === "create"
            ? null
            : command.before as unknown as Record<string, unknown>,
          after: node as unknown as Record<string, unknown>,
          description: command.description ?? (command.kind === "create"
            ? `Place ${node.name}`
            : geometryOnlyChanged(command.before, node)
              ? `Move ${node.name}`
              : `Edit ${node.name}`),
        });

        if (workingSession.getActiveDraft()?.toolType === "point") {
          workingSession.discardActiveDraft();
        }

        return { ok: true, node, operation };
      } catch (cause) {
        return {
          ok: false,
          reason: "persistence",
          message: cause instanceof Error ? cause.message : "Route Node could not be saved.",
        };
      }
    },
  };
}
