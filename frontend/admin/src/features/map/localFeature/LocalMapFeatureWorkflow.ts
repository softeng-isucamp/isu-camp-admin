import type { FeatureLinkEntity, LocalFeatureFamily, LocalMapFeatureEntity } from "../../../services/mapEditorApiClient";
import type { MapPoint } from "../campusBoundary";
import { geometryOnCampus } from "../campusBoundary";
import {
  buildRestoreLocalFeatureOperation,
  buildRetireLocalFeatureOperation,
  EDITABLE_LOCAL_FEATURE_FAMILIES,
  normalizeCuratedLocalFeatureProperties,
} from "../localFeatures";
import type { WorkingOperation } from "../types";
import { WorkingSessionManager, updatePropertiesOperation } from "../WorkingSessionManager";

type CreatableLocalFeatureFamily = Exclude<LocalFeatureFamily, "readonly_basemap" | "building_footprint">;

export type LocalMapFeatureFinalizeCommand =
  | {
      kind: "create";
      family: CreatableLocalFeatureFamily;
      name: string;
      coordinates: MapPoint[];
      campusBoundary?: MapPoint[];
      existingBoundary?: LocalMapFeatureEntity;
    }
  | { kind: "update"; before: LocalMapFeatureEntity; after: LocalMapFeatureEntity }
  | { kind: "retire"; feature: LocalMapFeatureEntity; link?: FeatureLinkEntity }
  | { kind: "restore"; feature: LocalMapFeatureEntity; link?: FeatureLinkEntity };

export type LocalMapFeatureFinalizeResult =
  | { ok: true; feature: LocalMapFeatureEntity; link?: FeatureLinkEntity; operation: WorkingOperation }
  | { ok: false; reason: "validation" | "stale"; message: string };

export interface LocalMapFeatureWorkflow {
  finalize(command: LocalMapFeatureFinalizeCommand): LocalMapFeatureFinalizeResult;
}

const definitionFor = (family: CreatableLocalFeatureFamily) =>
  EDITABLE_LOCAL_FEATURE_FAMILIES.find((definition) => definition.id === family);

const validateEditable = (feature: LocalMapFeatureEntity): string | null => {
  if (!feature.isEditable || feature.family === "readonly_basemap") return "This Local Map Feature is read-only.";
  if (!feature.name.trim()) return "Local Map Feature name is required.";
  return null;
};

export function createLocalMapFeatureWorkflow(dependencies: {
  workingSession: WorkingSessionManager;
}): LocalMapFeatureWorkflow {
  const { workingSession } = dependencies;

  return {
    finalize(command) {
      if (command.kind === "create") {
        const definition = definitionFor(command.family);
        if (!definition) return { ok: false, reason: "validation", message: "This Local Map Feature family cannot be created here." };
        if (!command.name.trim()) return { ok: false, reason: "validation", message: "Local Map Feature name is required." };
        const requiredPoints = definition.geometryType === "polygon" ? 3 : 2;
        if (command.coordinates.length < requiredPoints) {
          return { ok: false, reason: "validation", message: `${definition.label} requires at least ${requiredPoints} points.` };
        }
        if (command.campusBoundary && !geometryOnCampus(command.coordinates, command.campusBoundary)) {
          return { ok: false, reason: "validation", message: "New or modified geometry must stay inside the ISU Echague campus boundary." };
        }
        if (command.existingBoundary && (
          command.family !== "campus_boundary" || command.existingBoundary.family !== "campus_boundary"
        )) {
          return { ok: false, reason: "stale", message: "The existing Campus Boundary no longer matches this draft." };
        }
        const feature = normalizeCuratedLocalFeatureProperties({
          ...(command.existingBoundary ?? {}),
          id: command.existingBoundary?.id ?? `local-feature-${Date.now()}`,
          family: command.family,
          name: command.name.trim(),
          isEditable: true,
          geometryType: definition.geometryType,
          coordinates: [...command.coordinates],
          direction: definition.geometryType === "line" ? command.existingBoundary?.direction ?? "both" : undefined,
          status: "active",
        });
        const operation = workingSession.executeOperation({
          type: command.existingBoundary ? "update_geometry" : "create_entity",
          domain: "Local Map Data",
          entityId: feature.id,
          before: command.existingBoundary ? command.existingBoundary as unknown as Record<string, unknown> : null,
          after: feature as unknown as Record<string, unknown>,
          description: command.existingBoundary ? "Replace Campus Boundary geometry" : `Create ${definition.label}`,
        });
        if (workingSession.getActiveDraft()?.toolType === "local_feature") workingSession.discardActiveDraft();
        return { ok: true, feature, operation };
      }

      const editableIssue = validateEditable(command.kind === "update" ? command.before : command.feature);
      if (editableIssue) return { ok: false, reason: "validation", message: editableIssue };

      if (command.kind === "update") {
        if (command.before.id !== command.after.id || command.before.family !== command.after.family) {
          return { ok: false, reason: "stale", message: "This Local Map Feature draft no longer matches the selected feature." };
        }
        if (!command.after.name.trim()) {
          return { ok: false, reason: "validation", message: "Local Map Feature name is required." };
        }
        const feature = normalizeCuratedLocalFeatureProperties({
          ...command.before,
          name: command.after.name.trim(),
          surface: command.after.surface,
          access: command.after.access,
          direction: command.after.direction,
          isCovered: command.after.isCovered,
        });
        const operation = workingSession.executeOperation(updatePropertiesOperation(
          "Local Map Data",
          feature.id,
          command.before as unknown as Record<string, unknown>,
          feature as unknown as Record<string, unknown>,
          `Edit ${command.before.name} details`,
        ));
        return { ok: true, feature, operation };
      }

      if (command.link && command.link.featureId !== command.feature.id) {
        return { ok: false, reason: "stale", message: "This Local Map Feature no longer matches its Building link." };
      }
      if (command.kind === "retire") {
        if (command.feature.status === "retired") return { ok: false, reason: "validation", message: "This Local Map Feature is already retired." };
        const operation = workingSession.executeOperation(buildRetireLocalFeatureOperation(command.feature, command.link));
        return {
          ok: true,
          feature: { ...command.feature, status: "retired", linkedBuildingId: command.link ? null : command.feature.linkedBuildingId },
          link: command.link,
          operation,
        };
      }
      if (command.feature.status !== "retired") return { ok: false, reason: "validation", message: "This Local Map Feature is already active." };
      const operation = workingSession.executeOperation(buildRestoreLocalFeatureOperation(command.feature, command.link));
      return {
        ok: true,
        feature: { ...command.feature, status: "active", linkedBuildingId: command.link?.targetEntityId ?? command.feature.linkedBuildingId },
        link: command.link,
        operation,
      };
    },
  };
}
