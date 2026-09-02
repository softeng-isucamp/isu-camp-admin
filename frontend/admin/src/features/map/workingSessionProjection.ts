import type { WorkingOperation } from "./types";
import { traverseApplyOperation, traverseRevertOperation } from "./WorkingSessionManager";

export type ProjectedCollection = "locations" | "nodes" | "pathways" | "buildings" | "localFeatures" | "featureLinks";

export interface WorkingSessionEntityProjection {
  collection: ProjectedCollection;
  entityId: string;
  value: Record<string, unknown> | null;
}

const collectionFor = (record: Record<string, unknown>): ProjectedCollection | null => {
  if ("nodeType" in record) return "nodes";
  if ("sourceNodeId" in record && "destinationNodeId" in record) return "pathways";
  if ("family" in record && "geometryType" in record) return "localFeatures";
  if ("featureId" in record && "targetEntityId" in record) return "featureLinks";
  if ("positioned" in record || ("type" in record && "parentId" in record)) return "locations";
  if ("points" in record && "code" in record) return "buildings";
  return null;
};

export function projectWorkingSessionOperation(operation: WorkingOperation, direction: "undo" | "redo"): WorkingSessionEntityProjection[] {
  const projections: WorkingSessionEntityProjection[] = [];
  const collect = (leaf: WorkingOperation) => {
    if (leaf.type === "compound_batch") return;
    const reference = leaf.after ?? leaf.before;
    if (!reference) return;
    const collection = collectionFor(reference);
    if (!collection) return;
    projections.push({ collection, entityId: leaf.entityId, value: direction === "undo" ? leaf.before : leaf.after });
  };
  (direction === "undo" ? traverseRevertOperation : traverseApplyOperation)(operation, collect);
  return projections;
}
