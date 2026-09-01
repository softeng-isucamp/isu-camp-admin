// Canonical Spatial Domains & Object Types
export type SpatialDomain = "Locations" | "Routes & Paths" | "Local Map Data";

export type SpatialObjectType =
  | "building"
  | "outdoor_location"
  | "route_node"
  | "entrance_route_node"
  | "pathway"
  | "path_point"
  | "local_map_feature";

export type LocalFeatureFamily =
  | "building_footprint"
  | "parking_area"
  | "cartographic_walkway"
  | "vehicle_path"
  | "campus_boundary"
  | "readonly_basemap";

// Working Session Operation Types
export type WorkingOperationType =
  | "create_entity"
  | "update_geometry"
  | "update_properties"
  | "retire_entity"
  | "restore_entity"
  | "link_feature"
  | "unlink_feature"
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
export type ToolType = "select" | "point" | "polygon" | "pathway" | "local_feature";

export interface ProvisionalGeometry {
  points?: Array<{ x: number; y: number; lat?: number; lng?: number }>;
  isClosed?: boolean;
  startNodeId?: string;
  endNodeId?: string;
  [key: string]: unknown;
}

export interface ActiveToolDraft {
  id: string;
  toolType: "point" | "polygon" | "pathway" | "local_feature";
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
  futureOperations: WorkingOperation[];
  activeDraft: ActiveToolDraft | null;
  suspendedDrafts: ActiveToolDraft[];
  isDirty: boolean;
  uncommittedCount: number;
  canUndo: boolean;
  canRedo: boolean;
}

// Entity schemas used across Map Editor domains
export interface BuildingEntity {
  id: string;
  name: string;
  code: string;
  category?: string;
  status?: string;
  points?: [number, number][];
  [key: string]: unknown;
}

export interface OutdoorLocationEntity {
  id: string;
  name: string;
  code: string;
  type: string;
  lat: number | null;
  lng: number | null;
  positioned: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface RouteNodeEntity {
  id: string;
  name: string;
  nodeType: "Entrance" | "Junction" | "Access Point";
  associatedPlaceId?: string | null;
  lat: number;
  lng: number;
  status?: string;
  [key: string]: unknown;
}

export interface PathwayEntity {
  id: string;
  name: string;
  sourceNodeId: string;
  destinationNodeId: string;
  pathPoints: [number, number][];
  direction?: "Two-way" | "One-way" | "Unknown";
  status?: string;
  surfaceType?: string;
  wheelchairAccessible?: boolean;
  stepCount?: number;
  isCovered?: boolean;
  [key: string]: unknown;
}

export interface LocalMapFeatureEntity {
  id: string;
  family: LocalFeatureFamily;
  name: string;
  status: "active" | "retired";
  geometryType: "Point" | "LineString" | "Polygon";
  coordinates: unknown;
  properties?: Record<string, unknown>;
  sourceOsmId?: number | null;
  sourceOsmTags?: Record<string, string>;
  [key: string]: unknown;
}

export interface FeatureLinkEntity {
  id: string;
  featureId: string;
  targetDomain: SpatialDomain;
  targetEntityId: string;
  linkType: "building_footprint" | "entrance_association" | "custom";
  createdAt?: string;
}
