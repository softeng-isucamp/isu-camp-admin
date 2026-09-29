// Canonical Spatial Domains & Object Types
export type SpatialDomain = "Locations" | "Walking Network";

export type SpatialObjectType =
  | "building"
  | "campus_location"
  | "outdoor_location"
  | "route_node"
  | "entrance_route_node"
  | "pathway"
  | "path_point";

// Working Session Operation Types
export type WorkingOperationType =
  | "create_entity"
  | "update_geometry"
  | "update_properties"
  | "retire_entity"
  | "restore_entity"
  | "compound_batch";

export interface WorkingOperation {
  id: string;
  type: WorkingOperationType;
  domain: SpatialDomain;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  nestedOperations?: WorkingOperation[];
  description?: string;
  timestamp?: number;
}

// Active Tool Draft & Interruption States
export type ToolType = "select" | "point" | "polygon" | "pathway";

/** The Map Editor's interaction mode; `move` and `place` both belong to the point tool. */
export type EditorMode = "select" | "place" | "path" | "area" | "move";

export interface ProvisionalGeometry {
  points?: Array<{ x: number; y: number; lat?: number; lng?: number }>;
  isClosed?: boolean;
  startNodeId?: string;
  endNodeId?: string;
  [key: string]: unknown;
}

export interface ActiveToolDraft {
  id: string;
  toolType: "point" | "polygon" | "pathway";
  provisionalGeometry: ProvisionalGeometry;
  nestedRecords?: Record<string, unknown>;
  isSuspended: boolean;
  label?: string;
  createdAt?: number;
}

export type InterruptionAction = "keep_draft" | "continue_editing" | "discard_geometry";

// Working Session State snapshot
export interface WorkingSessionState {
  pastOperations: WorkingOperation[];
  activeDraft: ActiveToolDraft | null;
  suspendedDrafts: ActiveToolDraft[];
  isDirty: boolean;
  uncommittedCount: number;
}

export interface WorkingSessionSnapshot {
  schemaVersion: 1;
  pastOperations: WorkingOperation[];
  activeDraft: ActiveToolDraft | null;
  suspendedDrafts: ActiveToolDraft[];
  savedCheckpointIndex: number;
}
