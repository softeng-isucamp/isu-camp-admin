import type { Building, Location, LocationDraft } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import {
  buildBuildingFootprintOperation,
  buildCreateBuildingOperation,
  getBuildingAttachmentEligibility,
  validateBuildingFootprintGeometry,
  validateBuildingIdentityDetails,
  type BuildingIdentityInput,
  type BuildingValidationIssue,
} from "./buildingFootprint";
import type { WorkingOperation } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";

export interface BuildingFootprintContext {
  locations: readonly Location[];
  campusBoundary?: MapPoint[];
}

export type BuildingFootprintFinalizeCommand =
  | {
      kind: "create";
      identity: BuildingIdentityInput;
      points: MapPoint[];
      context: BuildingFootprintContext;
    }
  | {
      kind: "attach";
      building: Building;
      points: MapPoint[];
      context: BuildingFootprintContext;
    }
  | {
      kind: "reshape";
      building: Building;
      points: MapPoint[];
      context: BuildingFootprintContext;
    };

export interface BuildingFootprintProjection {
  building: Building;
  location?: Location;
  operation: WorkingOperation;
}

export type BuildingFootprintFinalizeResult =
  | ({ ok: true } & BuildingFootprintProjection)
  | {
      ok: false;
      reason: "validation" | "persistence";
      message: string;
      issues?: BuildingValidationIssue[];
    };

export interface BuildingFootprintWriteAdapter {
  createBuilding(draft: LocationDraft): Promise<Location>;
  saveFootprint(building: Building, points: MapPoint[]): Promise<void>;
}

export interface BuildingFootprintWorkflow {
  finalize(command: BuildingFootprintFinalizeCommand): Promise<BuildingFootprintFinalizeResult>;
}

export function createBuildingFootprintWorkflow(dependencies: {
  adapter: BuildingFootprintWriteAdapter;
  workingSession: WorkingSessionManager;
}): BuildingFootprintWorkflow {
  const { adapter, workingSession } = dependencies;

  return {
    async finalize(command) {
      const geometryIssues = validateBuildingFootprintGeometry(command.points, command.context.campusBoundary);
      if (geometryIssues.length > 0) {
        return { ok: false, reason: "validation", message: geometryIssues[0].message, issues: geometryIssues };
      }

      if (command.kind === "create") {
        const identityIssues = validateBuildingIdentityDetails(command.identity, command.context.locations);
        if (identityIssues.length > 0) {
          return { ok: false, reason: "validation", message: identityIssues[0].message, issues: identityIssues };
        }
      }

      if (command.kind === "attach") {
        const eligibility = getBuildingAttachmentEligibility(command.building);
        if (!eligibility.eligible) return { ok: false, reason: "validation", message: eligibility.reason };
      }

      try {
        let projection: BuildingFootprintProjection;
        if (command.kind === "create") {
          const location = await adapter.createBuilding({
            name: command.identity.name.trim(),
            code: command.identity.code.trim(),
            type: command.identity.type ?? "Building",
            parentId: null,
            function: command.identity.function?.trim() || undefined,
            keywords: command.identity.keywords?.trim() || undefined,
            status: command.identity.status ?? "Active",
            lat: null,
            lng: null,
            positioned: false,
            polygonCoordinates: [...command.points],
          });
          const operation = workingSession.executeOperation(buildCreateBuildingOperation({
            name: location.name,
            code: location.code,
            type: location.type === "Facility" ? "Facility" : "Building",
            function: location.function,
            keywords: location.keywords,
            status: location.status,
          }, command.points, location.id));
          projection = {
            location,
            building: {
              id: location.id,
              name: location.name,
              code: location.code,
              type: location.type === "Facility" ? "Facility" : "Building",
              status: location.status,
              points: [...command.points],
            },
            operation,
          };
        } else {
          await adapter.saveFootprint(command.building, command.points);
          const operation = workingSession.executeOperation(
            buildBuildingFootprintOperation(command.building, command.points),
          );
          projection = {
            building: { ...command.building, points: [...command.points] },
            operation,
          };
        }

        if (workingSession.getActiveDraft()?.toolType === "polygon") {
          workingSession.discardActiveDraft();
        }
        return { ok: true, ...projection };
      } catch (cause) {
        return {
          ok: false,
          reason: "persistence",
          message: cause instanceof Error ? cause.message : "Building footprint could not be saved.",
        };
      }
    },
  };
}
