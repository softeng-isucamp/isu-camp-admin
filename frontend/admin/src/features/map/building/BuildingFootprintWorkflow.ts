import type { Building, Location, LocationDraft } from "../../../types";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapEditorApiClient";
import type { MapPoint } from "../campusBoundary";
import {
  buildAttachBuildingCompoundOperation,
  buildCreateBuildingCompoundOperation,
  getBuildingAttachmentEligibility,
  validateBuildingFootprintGeometry,
  validateBuildingIdentityDetails,
  type BuildingIdentityInput,
  type BuildingValidationIssue,
} from "../buildingFootprint";
import type { WorkingOperation } from "../types";
import { WorkingSessionManager, updateGeometryOperation } from "../WorkingSessionManager";

export interface BuildingFootprintContext {
  locations: readonly Location[];
  featureLinks: readonly FeatureLinkEntity[];
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
      footprint: LocalMapFeatureEntity;
      link: FeatureLinkEntity;
      points: MapPoint[];
      context: BuildingFootprintContext;
    };

export interface BuildingFootprintProjection {
  building: Building;
  location?: Location;
  footprint: LocalMapFeatureEntity;
  link: FeatureLinkEntity;
  operation: WorkingOperation;
}

export type BuildingFootprintFinalizeResult =
  | ({ ok: true } & BuildingFootprintProjection)
  | {
      ok: false;
      reason: "validation" | "persistence" | "stale";
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

const compoundEntities = (operation: WorkingOperation) => {
  const nested = operation.nestedOperations ?? [];
  const footprint = nested.find(
    (item) => item.domain === "Local Map Data" && item.type === "create_entity",
  )?.after as unknown as LocalMapFeatureEntity | undefined;
  const link = nested.find(
    (item) => item.domain === "Local Map Data" && item.type === "link_feature",
  )?.after as unknown as FeatureLinkEntity | undefined;
  if (!footprint || !link) throw new Error("Building footprint operation is incomplete.");
  return { footprint, link };
};

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
        const eligibility = getBuildingAttachmentEligibility(command.building, command.context.featureLinks);
        if (!eligibility.eligible) return { ok: false, reason: "validation", message: eligibility.reason };
      }

      if (command.kind === "reshape" && (
        command.link.featureId !== command.footprint.id
        || command.link.targetEntityId !== command.building.id
        || command.link.targetDomain !== "Locations"
        || command.link.linkType !== "building_footprint"
        || command.footprint.family !== "building_footprint"
        || command.footprint.geometryType !== "polygon"
      )) {
        return {
          ok: false,
          reason: "stale",
          message: "This Building footprint no longer matches its ownership link.",
        };
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
          const compound = buildCreateBuildingCompoundOperation({
            name: location.name,
            code: location.code,
            type: location.type === "Facility" ? "Facility" : "Building",
            function: location.function,
            keywords: location.keywords,
            status: location.status,
          }, command.points, location.id);
          const operation = workingSession.executeBatch(
            compound.description ?? `Create ${location.name} with footprint`,
            compound.domain,
            compound.entityId,
            compound.nestedOperations ?? [],
          );
          const { footprint, link } = compoundEntities(operation);
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
            footprint,
            link,
            operation,
          };
        } else if (command.kind === "attach") {
          await adapter.saveFootprint(command.building, command.points);
          const compound = buildAttachBuildingCompoundOperation(command.building, command.points);
          const operation = workingSession.executeBatch(
            compound.description ?? `Attach footprint to ${command.building.name}`,
            compound.domain,
            compound.entityId,
            compound.nestedOperations ?? [],
          );
          const { footprint, link } = compoundEntities(operation);
          projection = {
            building: { ...command.building, points: [...command.points] },
            footprint,
            link,
            operation,
          };
        } else {
          await adapter.saveFootprint(command.building, command.points);
          const footprint = {
            ...command.footprint,
            coordinates: [...command.points],
            linkedBuildingId: command.building.id,
          };
          const operation = workingSession.executeOperation(updateGeometryOperation(
            "Local Map Data",
            footprint.id,
            command.footprint as unknown as Record<string, unknown>,
            footprint as unknown as Record<string, unknown>,
            `Reshape linked footprint for ${command.building.name}`,
          ));
          projection = {
            building: { ...command.building, points: [...command.points] },
            footprint,
            link: command.link,
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
