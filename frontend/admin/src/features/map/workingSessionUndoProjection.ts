import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../services/mapLayers";
import type { WorkingOperation } from "./types";

export type ProjectedCollection = "locations" | "nodes" | "pathways" | "buildings" | "localFeatures" | "featureLinks";

export interface OperationProjection {
  collection: ProjectedCollection;
  entityId: string;
  value: Record<string, unknown> | null;
}

/**
 * Projects a WorkingOperation onto its affected collections based on domain and direction.
 * Used during undo/redo to apply operations to local state collections.
 */
export function projectWorkingSessionOperation(
  operation: WorkingOperation,
  direction: "undo" | "redo",
  context?: {
    featureLinks?: readonly FeatureLinkEntity[];
    localFeatures?: readonly LocalMapFeatureEntity[];
  },
): OperationProjection[] {
  if (operation.type === "compound_batch" && operation.nestedOperations) {
    const list = direction === "undo"
      ? [...operation.nestedOperations].reverse()
      : operation.nestedOperations;
    const batchFeatures: LocalMapFeatureEntity[] = [];
    const batchLinks: FeatureLinkEntity[] = [];
    for (const nested of operation.nestedOperations) {
      if (nested.domain === "Local Map Data") {
        if (nested.type === "link_feature" || nested.type === "unlink_feature") {
          const l = (nested.after ?? nested.before) as FeatureLinkEntity | null;
          if (l) batchLinks.push(l);
        } else if (nested.type === "create_entity" || nested.type === "update_geometry" || nested.type === "retire_entity") {
          const f = (nested.after ?? nested.before) as LocalMapFeatureEntity | null;
          if (f) batchFeatures.push(f);
        }
      }
    }
    const combinedContext = {
      featureLinks: [...batchLinks, ...(context?.featureLinks ?? [])],
      localFeatures: [...batchFeatures, ...(context?.localFeatures ?? [])],
    };
    return list.flatMap((nested) => projectWorkingSessionOperation(nested, direction, combinedContext));
  }

  const value = direction === "undo" ? operation.before : operation.after;

  // Map domain + type to affected collections
  if (operation.domain === "Locations") {
    const projections: OperationProjection[] = [{ collection: "locations", entityId: operation.entityId, value }];
    const candidate = (value ?? (direction === "undo" ? operation.before : operation.after)) as Record<string, unknown> | null;
    if (candidate && (candidate.type === "Building" || "points" in candidate)) {
      projections.push({ collection: "buildings", entityId: operation.entityId, value });
    }
    return projections;
  } else if (operation.domain === "Walking Network") {
    // Pathways and nodes are in the same domain
    if (operation.type === "update_geometry" || operation.type === "create_entity" || operation.type === "retire_entity" || operation.type === "restore_entity" || operation.type === "update_properties") {
      // Determine if it's a pathway or node by checking the record structure
      if (value && typeof value === "object" && ("sourceNodeId" in value || "destinationNodeId" in value)) {
        return [{ collection: "pathways", entityId: operation.entityId, value }];
      } else {
        return [{ collection: "nodes", entityId: operation.entityId, value }];
      }
    }
    return [{ collection: "nodes", entityId: operation.entityId, value }];
  } else if (operation.domain === "Local Map Data") {
    if (operation.type === "link_feature" || operation.type === "unlink_feature") {
      const projections: OperationProjection[] = [{ collection: "featureLinks", entityId: operation.entityId, value }];
      const link = (operation.type === "link_feature" ? operation.after : operation.before) as FeatureLinkEntity | null;
      if (link && link.targetDomain === "Locations" && link.linkType === "building_footprint") {
        const footprint = context?.localFeatures?.find((feat) => feat.id === link.featureId);
        const shouldHaveFootprint = direction === "undo"
          ? operation.type === "unlink_feature"
          : operation.type === "link_feature";
        projections.push({
          collection: "buildings",
          entityId: link.targetEntityId,
          value: shouldHaveFootprint
            ? { id: link.targetEntityId, points: footprint?.coordinates ?? [] }
            : { id: link.targetEntityId, points: [] },
        });
      }
      return projections;
    }
    const projections: OperationProjection[] = [{ collection: "localFeatures", entityId: operation.entityId, value }];
    const feat = (value ?? (direction === "undo" ? operation.before : operation.after)) as Partial<LocalMapFeatureEntity> | null;
    if (feat && feat.family === "building_footprint") {
      const link = context?.featureLinks?.find(
        (item) => item.featureId === feat.id && item.targetDomain === "Locations" && item.linkType === "building_footprint",
      );
      const targetBuildingId = link?.targetEntityId ?? feat.linkedBuildingId;
      if (targetBuildingId) {
        projections.push({
          collection: "buildings",
          entityId: targetBuildingId,
          value: direction === "undo"
            ? { id: targetBuildingId, points: [] }
            : { id: targetBuildingId, points: feat.coordinates ?? [] },
        });
      }
    }
    return projections;
  }

  // Fallback for building operations (these might come through as Locations domain)
  if (value && typeof value === "object" && "points" in value) {
    return [{ collection: "buildings", entityId: operation.entityId, value }];
  }

  return [];
}
