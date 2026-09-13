import type { Pathway, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import { distanceInMeters } from "../pointInteractions";
import {
  pathwayWithSuggestedName,
  validatePathwayDraft,
  withoutEndpointPathPoints,
  type PathwayDraftIssue,
} from "../mapEditing";
import type { WorkingOperation } from "../types";
import { WorkingSessionManager, updateGeometryOperation, updatePropertiesOperation } from "../WorkingSessionManager";

export interface PathwayValidationContext {
  nodes: readonly RouteNode[];
  existingPathways: readonly Pathway[];
  campusBoundary?: MapPoint[];
}

export type PathwayFinalizeCommand =
  | {
      kind: "create";
      draft: Pathway;
      context: PathwayValidationContext;
      description?: string;
    }
  | {
      kind: "update";
      before: Pathway;
      after: Pathway;
      context: PathwayValidationContext;
      description?: string;
    };

export type PathwayFinalizeResult =
  | { ok: true; pathway: Pathway; operation: WorkingOperation }
  | {
      ok: false;
      reason: "validation" | "persistence" | "stale";
      message: string;
      issues?: PathwayDraftIssue[];
    };

export interface PathwayWriteAdapter {
  createPathway(pathway: Omit<Pathway, "id">): Promise<Pathway>;
  updatePathway(pathway: Pathway): Promise<Pathway>;
}

export interface PathwayWorkflow {
  finalize(command: PathwayFinalizeCommand): Promise<PathwayFinalizeResult>;
}

const pointFor = (nodes: readonly RouteNode[], id: string): MapPoint => {
  const node = nodes.find((candidate) => candidate.id === id);
  return node ? [node.lat, node.lng] : [Number.NaN, Number.NaN];
};

const prepare = (
  pathway: Pathway,
  context: PathwayValidationContext,
): { pathway: Pathway } | { issue: string } => {
  const named = pathwayWithSuggestedName(pathway, [...context.nodes]);
  const source = pointFor(context.nodes, named.sourceNodeId);
  const destination = pointFor(context.nodes, named.destinationNodeId);
  const pathPoints = withoutEndpointPathPoints([...named.pathPoints], source, destination);
  const metricPoints = [source, ...pathPoints, destination];
  if (!metricPoints.every(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude))) {
    return { issue: "Pathway endpoints and Path Points must use valid coordinates." };
  }
  const distanceMeters = metricPoints.slice(1).reduce(
    (total, point, index) => total + distanceInMeters(metricPoints[index], point),
    0,
  );
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return { issue: "Pathway geometry must have a positive distance." };
  }
  return {
    pathway: {
      ...named,
      pathPoints,
      distance: `${Math.max(1, Math.round(distanceMeters))} m`,
      time: `${Math.max(1, Math.ceil(distanceMeters / 80))} min`,
    },
  };
};

const pathwayProperties = ({ pathPoints: _points, distance: _distance, time: _time, ...properties }: Pathway) => properties;

export function createPathwayWorkflow(dependencies: {
  adapter: PathwayWriteAdapter;
  workingSession: WorkingSessionManager;
}): PathwayWorkflow {
  const { adapter, workingSession } = dependencies;

  return {
    async finalize(command) {
      if (command.kind === "update" && command.before.id !== command.after.id) {
        return { ok: false, reason: "stale", message: "This Pathway draft no longer matches the selected Pathway." };
      }

      const preparation = prepare(command.kind === "create" ? command.draft : command.after, command.context);
      if ("issue" in preparation) {
        return { ok: false, reason: "validation", message: preparation.issue };
      }
      const candidate = preparation.pathway;
      const issues = validatePathwayDraft(candidate, [...command.context.nodes], command.context.campusBoundary, {
        existingPathways: command.context.existingPathways.filter((pathway) => pathway.id !== candidate.id),
        requireActiveEndpoints: true,
      });
      if (issues.length > 0) {
        return { ok: false, reason: "validation", message: issues[0].message, issues };
      }

      try {
        const pathway = command.kind === "create"
          ? await adapter.createPathway((({ id: _id, ...draft }) => draft)(candidate))
          : await adapter.updatePathway(candidate);
        let operation: WorkingOperation;
        if (command.kind === "create") {
          operation = workingSession.executeOperation({
            type: "create_entity",
            domain: "Walking Network",
            entityId: pathway.id,
            before: null,
            after: pathway as unknown as Record<string, unknown>,
            description: command.description ?? `Create ${pathway.name}`,
          });
        } else {
          const geometryChanged = JSON.stringify(command.before.pathPoints) !== JSON.stringify(pathway.pathPoints)
            || command.before.distance !== pathway.distance
            || command.before.time !== pathway.time;
          const propertiesChanged = JSON.stringify(pathwayProperties(command.before)) !== JSON.stringify(pathwayProperties(pathway));
          if (geometryChanged && propertiesChanged) {
            operation = workingSession.executeBatch(
              command.description ?? `Edit ${pathway.name}`,
              "Walking Network",
              pathway.id,
              [
                updatePropertiesOperation("Walking Network", pathway.id, command.before as unknown as Record<string, unknown>, pathway as unknown as Record<string, unknown>, `Edit ${pathway.name}`),
                updateGeometryOperation("Walking Network", pathway.id, command.before as unknown as Record<string, unknown>, pathway as unknown as Record<string, unknown>, `Reshape ${pathway.name}`),
              ],
            );
          } else {
            operation = workingSession.executeOperation(
              geometryChanged
                ? updateGeometryOperation("Walking Network", pathway.id, command.before as unknown as Record<string, unknown>, pathway as unknown as Record<string, unknown>, command.description ?? `Reshape ${pathway.name}`)
                : updatePropertiesOperation("Walking Network", pathway.id, command.before as unknown as Record<string, unknown>, pathway as unknown as Record<string, unknown>, command.description ?? `Edit ${pathway.name}`),
            );
          }
        }

        if (workingSession.getActiveDraft()?.toolType === "pathway") {
          workingSession.discardActiveDraft();
        }
        return { ok: true, pathway, operation };
      } catch (cause) {
        return {
          ok: false,
          reason: "persistence",
          message: cause instanceof Error ? cause.message : "Pathway could not be saved.",
        };
      }
    },
  };
}
