import type {
  Building,
  Location,
  LocationType,
  Pathway,
  RecordStatus,
  RouteNode,
  Shade,
  SourceProvenance,
} from "../types";
import { echagueCampusBoundary } from "../features/map/campusBoundary";
import { buildings as mockBuildings, locations as mockLocations, routeNodes as mockRouteNodes, pathways as mockPathways } from "./mockData";

// ============================================================================
// 1. Spatial Domains & Core Operation Types
// ============================================================================

export type SpatialDomain = "Locations" | "Walking Network" | "Local Map Data";

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

export type OperationType =
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
  type: OperationType;
  domain: SpatialDomain;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  nestedOperations?: WorkingOperation[];
  description?: string;
}

export interface ActiveToolDraft {
  id: string;
  toolType: "point" | "polygon" | "pathway" | "local_feature";
  provisionalGeometry: {
    points?: Array<{ x: number; y: number; lat?: number; lng?: number }>;
    isClosed?: boolean;
    startNodeId?: string;
    endNodeId?: string;
  };
  nestedRecords?: Record<string, unknown>;
  isSuspended: boolean;
}

// ============================================================================
// 2. Normalized Map Editor Entities
// ============================================================================

export interface BuildingEntity {
  id: string;
  name: string;
  code: string;
  status: "Active" | "Inactive" | "Open" | "Closed" | "Unknown";
  category?: string;
  linkedFeatureId?: string | null;
  entranceNodeIds: string[];
  source?: SourceProvenance;
}

export interface OutdoorLocationEntity {
  id: string;
  name: string;
  code: string;
  type: LocationType;
  category?: string;
  status: RecordStatus;
  lat: number | null;
  lng: number | null;
  positioned: boolean;
  photo?: Location["photo"];
  source?: SourceProvenance;
}

export interface RouteNodeEntity {
  id: string;
  name: string;
  nodeType: "Entrance" | "Junction" | "Access Point";
  buildingId?: string | null;
  associatedPlaceId?: string | null;
  lat: number;
  lng: number;
  status?: RecordStatus;
  sourceOsmNodeId?: number | null;
  sourceWayId?: number;
  sourceWayIds?: number[];
  source?: SourceProvenance;
}

export interface PathwayEntity {
  id: string;
  name: string;
  sourceNodeId: string;
  destinationNodeId: string;
  distance?: string;
  time?: string;
  shade?: Shade;
  type: string;
  direction?: "Two-way" | "One-way" | "Unknown";
  status: "Open" | "Closed" | "Unknown";
  pathPoints: [number, number][];
  surface?: string;
  wheelchair?: boolean | string;
  isCovered?: boolean;
  sourceOsmNodeIds?: number[];
  sourceWayId?: number;
  source?: SourceProvenance;
}

export interface LocalMapFeatureEntity {
  id: string;
  family: LocalFeatureFamily;
  name: string;
  isEditable: boolean;
  geometryType: "point" | "polygon" | "line";
  coordinates: [number, number][] | [number, number][][] | [number, number];
  surface?: string;
  access?: string;
  direction?: string;
  isCovered?: boolean;
  status?: "active" | "retired";
  linkedBuildingId?: string | null;
  areaOrLength?: string;
  provenance?: {
    osmId?: string;
    osmVersion?: number;
    importedAt?: string;
    license?: string;
    rawTags?: Record<string, string>;
  };
}

export interface FeatureLinkEntity {
  id: string;
  featureId: string;
  targetDomain: "Locations";
  targetEntityId: string;
  linkType: "building_footprint";
  createdAt?: string;
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][]; // GeoJSON standard [lng, lat]
}

export interface AdminDraftMetadata {
  draftVersion: number;
  updatedAt: string;
  lastAuthorId: string;
}

export interface MapEditorLayers {
  buildings: BuildingEntity[];
  outdoorLocations: OutdoorLocationEntity[];
  routeNodes: RouteNodeEntity[];
  pathways: PathwayEntity[];
  localFeatures: LocalMapFeatureEntity[];
  featureLinks: FeatureLinkEntity[];
}

export interface MapEditorBootstrap {
  adminDraft: AdminDraftMetadata;
  publishedVersionId: string;
  campusBoundary: GeoJSONPolygon;
  layers: MapEditorLayers;
}

export interface EligibleUnattachedRecord {
  id: string;
  code: string;
  name: string;
  category: string;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface ConflictingEntityDiff {
  entityId: string;
  field: string;
  serverValue: unknown;
  clientValue: unknown;
  conflictType: string;
}

export interface SaveDraftCommand {
  projectId: string;
  baseDraftVersion: number;
  requestId: string;
  operations: WorkingOperation[];
}

export type SaveDraftResult =
  | {
      success: true;
      newDraftVersion: number;
      updatedAt: string;
    }
  | {
      success: false;
      errorType: "CONCURRENCY_CONFLICT";
      currentServerDraftVersion: number;
      conflictingEntities: ConflictingEntityDiff[];
      nonConflictingOperationsCount: number;
    }
  | {
      success: false;
      errorType: "FIELD_VALIDATION_ERROR" | "FEATURE_GEOMETRY_ERROR" | "TOPOLOGY_CONSTRAINT_ERROR";
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      success: false;
      errorType: "SERVICE_UNAVAILABLE";
      message: string;
    };

export interface PublishDraftResult {
  success: boolean;
  newPublishedVersionId: string;
  publishedAt: string;
  warnings?: string[];
}

export interface DiscardDraftResult {
  success: boolean;
}

// ============================================================================
// 3. MapEditorApiClient Interface
// ============================================================================

export interface MapEditorApiClient {
  getMapEditorBootstrap(projectId: string): Promise<MapEditorBootstrap>;
  getEligibleUnattachedRecords(
    projectId: string,
    domain: "buildings" | "locations",
    searchQuery?: string
  ): Promise<EligibleUnattachedRecord[]>;
  saveDraft(command: SaveDraftCommand): Promise<SaveDraftResult>;
  saveDraft(projectId: string, baseDraftVersion: number, operations: WorkingOperation[]): Promise<SaveDraftResult>;
  publishDraft(
    projectId: string,
    draftVersion: number
  ): Promise<PublishDraftResult>;
  discardDraft(
    projectId: string,
    draftVersion: number
  ): Promise<DiscardDraftResult>;
}

// ============================================================================
// 4. Normalization Helpers
// ============================================================================

export interface RawSeedSources {
  buildings: Building[];
  locations: Location[];
  routeNodes: RouteNode[];
  pathways: Pathway[];
  additionalLocalFeatures?: LocalMapFeatureEntity[];
}

export function createCampusBoundaryGeoJson(points: [number, number][] = echagueCampusBoundary): GeoJSONPolygon {
  const ring = points.map(([lat, lng]) => [lng, lat] as [number, number]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

export function normalizeMapLayers(sources: RawSeedSources): MapEditorLayers {
  const localFeatures: LocalMapFeatureEntity[] = [];
  const featureLinks: FeatureLinkEntity[] = [];
  const buildings: BuildingEntity[] = [];
  const outdoorLocations: OutdoorLocationEntity[] = [];
  const routeNodes: RouteNodeEntity[] = [];
  const pathways: PathwayEntity[] = [];

  // Seed campus boundary feature
  localFeatures.push({
    id: "feat-poly-campus-boundary",
    family: "campus_boundary",
    name: "ISU Echague Campus Perimeter",
    isEditable: true,
    geometryType: "polygon",
    coordinates: echagueCampusBoundary.map(([lat, lng]) => [lat, lng] as [number, number]),
    status: "active",
    areaOrLength: "1,250,000 m²",
    provenance: {
      osmId: "relation/isu-echague-perimeter",
      osmVersion: 1,
      importedAt: "2026-08-01T00:00:00Z",
      license: "ODbL (OpenStreetMap contributors)",
      rawTags: { boundary: "administrative", name: "Isabela State University - Main Campus" },
    },
  });

  // Seed sample basemap / parking / cartographic features
  localFeatures.push(
    {
      id: "feat-poly-pkg-west",
      family: "parking_area",
      name: "Engineering West Parking Lot",
      isEditable: true,
      geometryType: "polygon",
      coordinates: [
        [16.7212, 121.6888],
        [16.7215, 121.6892],
        [16.7211, 121.6895],
        [16.7208, 121.6891],
      ],
      surface: "asphalt",
      access: "campus_only",
      status: "active",
      areaOrLength: "1,420 m²",
      provenance: {
        osmId: "way/74920194",
        osmVersion: 4,
        importedAt: "2026-08-15T08:30:00Z",
        license: "ODbL (OpenStreetMap contributors)",
        rawTags: { amenity: "parking", surface: "asphalt" },
      },
    },
    {
      id: "feat-line-walkway-oval",
      family: "cartographic_walkway",
      name: "Oval Perimeter Walkway",
      isEditable: true,
      geometryType: "line",
      coordinates: [
        [16.7198, 121.6888],
        [16.7202, 121.6893],
        [16.7207, 121.6897],
      ],
      surface: "concrete",
      access: "yes",
      direction: "both",
      status: "active",
      areaOrLength: "340 m",
      provenance: {
        osmId: "way/88219401",
        osmVersion: 2,
        importedAt: "2026-08-15T08:30:00Z",
        license: "ODbL (OpenStreetMap contributors)",
        rawTags: { highway: "footway", surface: "concrete" },
      },
    },
    {
      id: "feat-line-vehicle-ring",
      family: "vehicle_path",
      name: "Campus Ring Service Road",
      isEditable: true,
      geometryType: "line",
      coordinates: [
        [16.7195, 121.6884],
        [16.7201, 121.6887],
        [16.7208, 121.6891],
      ],
      surface: "asphalt",
      access: "campus_only",
      direction: "both",
      status: "active",
      areaOrLength: "780 m",
      provenance: {
        osmId: "way/90124855",
        osmVersion: 3,
        importedAt: "2026-08-15T08:30:00Z",
        license: "ODbL (OpenStreetMap contributors)",
        rawTags: { highway: "service", surface: "asphalt", oneway: "no" },
      },
    },
    {
      id: "feat-poly-water-pond-01",
      family: "readonly_basemap",
      name: "Campus Aquaculture Lagoon",
      isEditable: false,
      geometryType: "polygon",
      coordinates: [
        [16.7225, 121.691],
        [16.7229, 121.6918],
        [16.7223, 121.6922],
        [16.7219, 121.6914],
      ],
      status: "active",
      areaOrLength: "3,100 m²",
      provenance: {
        osmId: "way/9823101",
        osmVersion: 2,
        importedAt: "2026-08-15T08:30:00Z",
        license: "ODbL (OpenStreetMap contributors)",
        rawTags: { natural: "water", water: "lagoon" },
      },
    }
  );

  if (sources.additionalLocalFeatures) {
    localFeatures.push(...sources.additionalLocalFeatures);
  }

  // Normalize Route Nodes
  for (const node of sources.routeNodes) {
    routeNodes.push({
      id: node.id,
      name: node.name || `Node ${node.id}`,
      nodeType: node.nodeType,
      buildingId: node.associatedPlaceId ?? null,
      associatedPlaceId: node.associatedPlaceId ?? null,
      lat: node.lat,
      lng: node.lng,
      status: node.status ?? "Active",
      sourceOsmNodeId: node.sourceOsmNodeId ?? null,
      sourceWayId: node.sourceWayId,
      sourceWayIds: node.sourceWayIds,
      source: node.source,
    });
  }

  // Normalize Buildings and extract Footprint Local Features & Feature Links
  for (const bld of sources.buildings) {
    const hasPolygon = Array.isArray(bld.points) && bld.points.length >= 3;
    let featureId: string | null = null;

    if (hasPolygon) {
      featureId = `feat-poly-${bld.id}`;
      localFeatures.push({
        id: featureId,
        family: "building_footprint",
        name: `${bld.name} Footprint`,
        isEditable: true,
        geometryType: "polygon",
        coordinates: bld.points.map(([lat, lng]) => [lat, lng] as [number, number]),
        status: "active",
        linkedBuildingId: bld.id,
        areaOrLength: "850 m²",
        provenance: bld.source
          ? {
              osmId: `${bld.source.sourceType}/${bld.source.sourceId}`,
              osmVersion: 1,
              importedAt: "2026-08-01T00:00:00Z",
              license: "ODbL (OpenStreetMap contributors)",
              rawTags: { building: "yes", name: bld.name },
            }
          : undefined,
      });

      featureLinks.push({
        id: `link-${bld.id}`,
        featureId,
        targetDomain: "Locations",
        targetEntityId: bld.id,
        linkType: "building_footprint",
        createdAt: "2026-08-15T00:00:00Z",
      });
    }

    const entranceNodeIds = routeNodes
      .filter(
        (n) =>
          n.nodeType === "Entrance" &&
          (n.buildingId === bld.id ||
            n.associatedPlaceId === bld.id ||
            n.name.toLowerCase().includes((bld.name || "").toLowerCase()))
      )
      .map((n) => n.id);

    buildings.push({
      id: bld.id,
      name: bld.name,
      code: bld.code,
      status: bld.status ?? "Active",
      category: "Academic / University Building",
      linkedFeatureId: featureId,
      entranceNodeIds,
      source: bld.source,
    });
  }

  // Normalize Outdoor Locations (non-building locations)
  for (const loc of sources.locations) {
    if (loc.type === "Building") continue;
    outdoorLocations.push({
      id: loc.id,
      name: loc.name,
      code: loc.code,
      type: loc.type,
      category: loc.function || loc.type,
      status: loc.status ?? "Active",
      lat: loc.lat,
      lng: loc.lng,
      positioned: loc.positioned ?? Boolean(loc.lat !== null && loc.lng !== null),
      photo: loc.photo,
      source: loc.source,
    });
  }

  // Normalize Pathways
  for (const p of sources.pathways) {
    pathways.push({
      id: p.id,
      name: p.name,
      sourceNodeId: p.sourceNodeId,
      destinationNodeId: p.destinationNodeId,
      distance: p.distance ?? "—",
      time: p.time ?? "—",
      shade: p.shade ?? "Unknown",
      type: p.type ?? "Campus Walkway",
      direction: p.direction ?? "Two-way",
      status: p.status ?? "Open",
      pathPoints: p.pathPoints.map(([lat, lng]) => [lat, lng]),
      surface: "Concrete / Paved",
      wheelchair: true,
      isCovered: p.shade === "Fully Shaded",
      sourceOsmNodeIds: p.sourceOsmNodeIds,
      sourceWayId: p.sourceWayId,
      source: p.source,
    });
  }

  return {
    buildings,
    outdoorLocations,
    routeNodes,
    pathways,
    localFeatures,
    featureLinks,
  };
}

// ============================================================================
// 5. Conflict Resolution & Diff Extraction Helper
// ============================================================================

export function extractEntityFromLayers(
  layers: MapEditorLayers,
  domain: SpatialDomain,
  entityId: string
): Record<string, unknown> | null {
  if (domain === "Locations") {
    const building = layers.buildings.find((b) => b.id === entityId);
    if (building) return building as unknown as Record<string, unknown>;
    const loc = layers.outdoorLocations.find((l) => l.id === entityId);
    if (loc) return loc as unknown as Record<string, unknown>;
  } else if (domain === "Walking Network") {
    const node = layers.routeNodes.find((n) => n.id === entityId);
    if (node) return node as unknown as Record<string, unknown>;
    const path = layers.pathways.find((p) => p.id === entityId);
    if (path) return path as unknown as Record<string, unknown>;
  } else if (domain === "Local Map Data") {
    const feat = layers.localFeatures.find((f) => f.id === entityId);
    if (feat) return feat as unknown as Record<string, unknown>;
    const link = layers.featureLinks.find((l) => l.id === entityId);
    if (link) return link as unknown as Record<string, unknown>;
  }
  return null;
}

export function extractConcurrencyConflicts(
  operations: WorkingOperation[],
  serverLayers: MapEditorLayers
): { conflictingEntities: ConflictingEntityDiff[]; nonConflictingCount: number } {
  const conflictingEntities: ConflictingEntityDiff[] = [];
  const conflictingEntityIds = new Set<string>();

  for (const op of operations) {
    const ops = op.type === "compound_batch" && op.nestedOperations ? op.nestedOperations : [op];

    for (const subOp of ops) {
      const serverEntity = extractEntityFromLayers(serverLayers, subOp.domain, subOp.entityId);

      if (subOp.before && !serverEntity) {
        conflictingEntities.push({
          entityId: subOp.entityId,
          field: "status",
          serverValue: null,
          clientValue: subOp.after?.status ?? "Active",
          conflictType: "DELETED_BY_OTHER",
        });
        conflictingEntityIds.add(subOp.entityId);
      } else if (!subOp.before && serverEntity) {
        conflictingEntities.push({
          entityId: subOp.entityId,
          field: "id",
          serverValue: serverEntity.id,
          clientValue: subOp.entityId,
          conflictType: "ALREADY_EXISTS",
        });
        conflictingEntityIds.add(subOp.entityId);
      } else if (subOp.before && serverEntity) {
        for (const [key, clientBeforeVal] of Object.entries(subOp.before)) {
          const serverVal = serverEntity[key];
          const clientAfterVal = subOp.after?.[key];
          if (
            JSON.stringify(serverVal) !== JSON.stringify(clientBeforeVal) &&
            JSON.stringify(serverVal) !== JSON.stringify(clientAfterVal)
          ) {
            conflictingEntities.push({
              entityId: subOp.entityId,
              field: key,
              serverValue: serverVal,
              clientValue: clientAfterVal,
              conflictType: "MODIFIED_BY_OTHER",
            });
            conflictingEntityIds.add(subOp.entityId);
          }
        }
      }
    }
  }

  // Count top-level operations whose target entity was not in the conflict set
  const nonConflictingCount = operations.filter((op) => !conflictingEntityIds.has(op.entityId)).length;

  return { conflictingEntities, nonConflictingCount };
}

export function filterNonConflictingOperations(
  operations: WorkingOperation[],
  conflictingEntityIds: Set<string>
): WorkingOperation[] {
  return operations.filter((op) => {
    if (op.type === "compound_batch" && op.nestedOperations) {
      return !op.nestedOperations.some((nested) => conflictingEntityIds.has(nested.entityId));
    }
    return !conflictingEntityIds.has(op.entityId);
  });
}

function validateDraftOperations(layers: MapEditorLayers, operations: WorkingOperation[]): SaveDraftResult | null {
  for (const operation of operations) {
    if (operation.type === "compound_batch" && operation.nestedOperations) {
      const nestedResult = validateDraftOperations(layers, operation.nestedOperations);
      if (nestedResult) return nestedResult;
      continue;
    }
    const collection = operation.domain === "Locations"
      ? [...layers.buildings, ...layers.outdoorLocations]
      : operation.domain === "Walking Network"
        ? [...layers.routeNodes, ...layers.pathways]
        : [...layers.localFeatures, ...layers.featureLinks];
    const existing = collection.find((item) => item.id === operation.entityId);
    if (operation.type === "create_entity" && existing) {
      return { success: false, errorType: "FIELD_VALIDATION_ERROR", message: `Entity ${operation.entityId} already exists.` };
    }
    if (operation.type !== "create_entity" && operation.type !== "compound_batch" && operation.type !== "link_feature" && !existing) {
      return { success: false, errorType: "FIELD_VALIDATION_ERROR", message: `Entity ${operation.entityId} is not owned by this Admin Draft.` };
    }
    if (operation.type === "unlink_feature" && !layers.featureLinks.some((link) => link.id === operation.entityId)) {
      return { success: false, errorType: "FIELD_VALIDATION_ERROR", message: `Feature link ${operation.entityId} is not owned by this Admin Draft.` };
    }
    if (operation.type === "link_feature") {
      const link = operation.after as Partial<FeatureLinkEntity> | null;
      if (!link || typeof link.featureId !== "string" || typeof link.targetEntityId !== "string"
        || !layers.localFeatures.some((feature) => feature.id === link.featureId)
        || !layers.buildings.some((building) => building.id === link.targetEntityId)) {
        return { success: false, errorType: "FIELD_VALIDATION_ERROR", message: `Feature link ${operation.entityId} references an unowned feature or Building.` };
      }
    }
    applyOperationToLayers(layers, operation);
  }
  return null;
}

// ============================================================================
// 6. Applying Operations to In-Memory Layers
// ============================================================================

export function applyOperationToLayers(layers: MapEditorLayers, op: WorkingOperation): void {
  if (op.type === "compound_batch" && op.nestedOperations) {
    for (const nested of op.nestedOperations) {
      applyOperationToLayers(layers, nested);
    }
    return;
  }

  switch (op.domain) {
    case "Locations": {
      if (op.type === "create_entity" && op.after) {
        if ("points" in op.after || "linkedFeatureId" in op.after) {
          layers.buildings.push(op.after as unknown as BuildingEntity);
        } else {
          layers.outdoorLocations.push(op.after as unknown as OutdoorLocationEntity);
        }
      } else if (op.type === "update_properties" || op.type === "update_geometry") {
        const bIndex = layers.buildings.findIndex((b) => b.id === op.entityId);
        if (bIndex >= 0 && op.after) {
          layers.buildings[bIndex] = { ...layers.buildings[bIndex], ...(op.after as unknown as Partial<BuildingEntity>) };
        }
        const lIndex = layers.outdoorLocations.findIndex((l) => l.id === op.entityId);
        if (lIndex >= 0 && op.after) {
          layers.outdoorLocations[lIndex] = { ...layers.outdoorLocations[lIndex], ...(op.after as unknown as Partial<OutdoorLocationEntity>) };
        }
      } else if (op.type === "retire_entity") {
        const bIndex = layers.buildings.findIndex((b) => b.id === op.entityId);
        if (bIndex >= 0) layers.buildings[bIndex].status = "Inactive";
        const lIndex = layers.outdoorLocations.findIndex((l) => l.id === op.entityId);
        if (lIndex >= 0) layers.outdoorLocations[lIndex].status = "Inactive";
      } else if (op.type === "restore_entity") {
        const bIndex = layers.buildings.findIndex((b) => b.id === op.entityId);
        if (bIndex >= 0) layers.buildings[bIndex].status = "Active";
        const lIndex = layers.outdoorLocations.findIndex((l) => l.id === op.entityId);
        if (lIndex >= 0) layers.outdoorLocations[lIndex].status = "Active";
      }
      break;
    }
    case "Walking Network": {
      if (op.type === "create_entity" && op.after) {
        if ("sourceNodeId" in op.after) {
          layers.pathways.push(op.after as unknown as PathwayEntity);
        } else {
          layers.routeNodes.push(op.after as unknown as RouteNodeEntity);
        }
      } else if (op.type === "update_geometry" || op.type === "update_properties") {
        const nIndex = layers.routeNodes.findIndex((n) => n.id === op.entityId);
        if (nIndex >= 0 && op.after) {
          layers.routeNodes[nIndex] = { ...layers.routeNodes[nIndex], ...(op.after as unknown as Partial<RouteNodeEntity>) };
        }
        const pIndex = layers.pathways.findIndex((p) => p.id === op.entityId);
        if (pIndex >= 0 && op.after) {
          layers.pathways[pIndex] = { ...layers.pathways[pIndex], ...(op.after as unknown as Partial<PathwayEntity>) };
        }
      } else if (op.type === "retire_entity") {
        const nIndex = layers.routeNodes.findIndex((n) => n.id === op.entityId);
        if (nIndex >= 0) layers.routeNodes[nIndex].status = "Inactive";
        const pIndex = layers.pathways.findIndex((p) => p.id === op.entityId);
        if (pIndex >= 0) layers.pathways[pIndex].status = "Closed";
      } else if (op.type === "restore_entity") {
        const nIndex = layers.routeNodes.findIndex((n) => n.id === op.entityId);
        if (nIndex >= 0) layers.routeNodes[nIndex].status = "Active";
        const pIndex = layers.pathways.findIndex((p) => p.id === op.entityId);
        if (pIndex >= 0) layers.pathways[pIndex].status = "Open";
      }
      break;
    }
    case "Local Map Data": {
      if (op.type === "create_entity" && op.after) {
        if ("featureId" in op.after && "targetEntityId" in op.after) {
          layers.featureLinks.push(op.after as unknown as FeatureLinkEntity);
        } else {
          layers.localFeatures.push(op.after as unknown as LocalMapFeatureEntity);
        }
      } else if (op.type === "update_geometry" || op.type === "update_properties") {
        const fIndex = layers.localFeatures.findIndex((f) => f.id === op.entityId);
        if (fIndex >= 0 && op.after) {
          layers.localFeatures[fIndex] = { ...layers.localFeatures[fIndex], ...(op.after as unknown as Partial<LocalMapFeatureEntity>) };
        }
      } else if (op.type === "link_feature" && op.after) {
        const link = op.after as unknown as FeatureLinkEntity;
        const exists = layers.featureLinks.some((l) => l.featureId === link.featureId && l.targetEntityId === link.targetEntityId);
        if (!exists) layers.featureLinks.push(link);
        const feat = layers.localFeatures.find((f) => f.id === link.featureId);
        if (feat) feat.linkedBuildingId = link.targetEntityId;
        const bld = layers.buildings.find((b) => b.id === link.targetEntityId);
        if (bld) bld.linkedFeatureId = link.featureId;
      } else if (op.type === "unlink_feature") {
        const link = layers.featureLinks.find(
          (l) => l.id === op.entityId || l.featureId === op.entityId || l.targetEntityId === op.entityId
        );
        const featId = link?.featureId ?? op.entityId;
        const targetId = link?.targetEntityId ?? op.entityId;
        layers.featureLinks = layers.featureLinks.filter(
          (l) => l.id !== op.entityId && l.featureId !== op.entityId && l.targetEntityId !== op.entityId
        );
        const feat = layers.localFeatures.find((f) => f.id === featId || f.linkedBuildingId === targetId);
        if (feat) feat.linkedBuildingId = null;
        const bld = layers.buildings.find((b) => b.id === targetId || b.linkedFeatureId === featId);
        if (bld) bld.linkedFeatureId = null;
      } else if (op.type === "retire_entity") {
        const fIndex = layers.localFeatures.findIndex((f) => f.id === op.entityId);
        if (fIndex >= 0) layers.localFeatures[fIndex].status = "retired";
      } else if (op.type === "restore_entity") {
        const fIndex = layers.localFeatures.findIndex((f) => f.id === op.entityId);
        if (fIndex >= 0) layers.localFeatures[fIndex].status = "active";
      }
      break;
    }
  }
}

// ============================================================================
// 7. Deterministic Local Mock Adapter
// ============================================================================

export interface LocalMapEditorAdapterOptions {
  seedSources?: RawSeedSources;
  initialDraftVersion?: number;
  initialPublishedVersionId?: string;
  authorId?: string;
}

export class LocalMapEditorAdapter implements MapEditorApiClient {
  private initialLayers: MapEditorLayers;
  private publishedLayers: MapEditorLayers;
  private currentLayers: MapEditorLayers;
  private adminDraft: AdminDraftMetadata;
  private publishedVersionId: string;
  private campusBoundary: GeoJSONPolygon;
  private simulatedConflict:
    | null
    | {
        serverVersion: number;
        conflictingEntities?: ConflictingEntityDiff[];
      } = null;
  private simulatedError: SaveDraftResult | null = null;
  private acceptedRequests = new Map<string, SaveDraftResult>();

  constructor(options?: LocalMapEditorAdapterOptions) {
    const rawSources: RawSeedSources = options?.seedSources ?? {
      buildings: mockBuildings,
      locations: mockLocations,
      routeNodes: mockRouteNodes,
      pathways: mockPathways,
    };

    this.initialLayers = normalizeMapLayers(rawSources);
    this.publishedLayers = structuredClone(this.initialLayers);
    this.currentLayers = structuredClone(this.initialLayers);
    this.campusBoundary = createCampusBoundaryGeoJson(echagueCampusBoundary);
    this.publishedVersionId = options?.initialPublishedVersionId ?? "pub-20260815-01";
    this.adminDraft = {
      draftVersion: options?.initialDraftVersion ?? 1,
      updatedAt: "2026-08-28T00:00:00.000Z",
      lastAuthorId: options?.authorId ?? "admin_justine",
    };
  }

  public setSimulatedConflict(
    conflict:
      | null
      | {
          serverVersion: number;
          conflictingEntities?: ConflictingEntityDiff[];
        }
  ): void {
    this.simulatedConflict = conflict;
  }

  public setSimulatedError(error: SaveDraftResult | null): void {
    this.simulatedError = error;
  }

  public reset(options?: LocalMapEditorAdapterOptions): void {
    const rawSources: RawSeedSources = options?.seedSources ?? {
      buildings: mockBuildings,
      locations: mockLocations,
      routeNodes: mockRouteNodes,
      pathways: mockPathways,
    };
    this.initialLayers = normalizeMapLayers(rawSources);
    this.publishedLayers = structuredClone(this.initialLayers);
    this.currentLayers = structuredClone(this.initialLayers);
    this.campusBoundary = createCampusBoundaryGeoJson(echagueCampusBoundary);
    this.publishedVersionId = options?.initialPublishedVersionId ?? "pub-20260815-01";
    this.adminDraft = {
      draftVersion: options?.initialDraftVersion ?? 1,
      updatedAt: "2026-08-28T00:00:00.000Z",
      lastAuthorId: options?.authorId ?? "admin_justine",
    };
    this.simulatedConflict = null;
    this.simulatedError = null;
    this.acceptedRequests.clear();
  }

  public async getMapEditorBootstrap(projectId: string): Promise<MapEditorBootstrap> {
    void projectId;
    return {
      adminDraft: { ...this.adminDraft },
      publishedVersionId: this.publishedVersionId,
      campusBoundary: structuredClone(this.campusBoundary),
      layers: structuredClone(this.currentLayers),
    };
  }

  public async getEligibleUnattachedRecords(
    projectId: string,
    domain: "buildings" | "locations",
    searchQuery = ""
  ): Promise<EligibleUnattachedRecord[]> {
    void projectId;
    const query = searchQuery.trim().toLowerCase();

    if (domain === "buildings") {
      const records: EligibleUnattachedRecord[] = this.currentLayers.buildings.map((bld) => {
        const isLinked = Boolean(bld.linkedFeatureId) ||
          this.currentLayers.featureLinks.some((link) => link.targetEntityId === bld.id);
        const linkedId = bld.linkedFeatureId ||
          this.currentLayers.featureLinks.find((link) => link.targetEntityId === bld.id)?.featureId;

        return {
          id: bld.id,
          code: bld.code,
          name: bld.name,
          category: bld.category || "Academic Building",
          eligible: !isLinked,
          ineligibleReason: isLinked ? `Already linked to polygon ${linkedId}` : undefined,
        };
      });

      if (!query) return records;
      return records.filter(
        (r) => r.name.toLowerCase().includes(query) || r.code.toLowerCase().includes(query)
      );
    }

    if (domain === "locations") {
      const records: EligibleUnattachedRecord[] = this.currentLayers.outdoorLocations.map((loc) => {
        const hasPosition = loc.lat !== null && loc.lng !== null;
        return {
          id: loc.id,
          code: loc.code,
          name: loc.name,
          category: loc.category || loc.type,
          eligible: !hasPosition,
          ineligibleReason: hasPosition
            ? `Already positioned at ${loc.lat?.toFixed(4)}, ${loc.lng?.toFixed(4)}`
            : undefined,
        };
      });

      if (!query) return records;
      return records.filter(
        (r) => r.name.toLowerCase().includes(query) || r.code.toLowerCase().includes(query)
      );
    }

    return [];
  }

  public async saveDraft(
    commandOrProjectId: SaveDraftCommand | string,
    legacyBaseDraftVersion?: number,
    legacyOperations?: WorkingOperation[],
  ): Promise<SaveDraftResult> {
    const command: SaveDraftCommand = typeof commandOrProjectId === "string"
      ? { projectId: commandOrProjectId, baseDraftVersion: legacyBaseDraftVersion ?? this.adminDraft.draftVersion, requestId: `legacy-${Date.now()}-${Math.random()}`, operations: legacyOperations ?? [] }
      : commandOrProjectId;
    void command.projectId;

    const prior = this.acceptedRequests.get(command.requestId);
    if (prior) return structuredClone(prior);

    if (this.simulatedError) {
      return structuredClone(this.simulatedError);
    }

    if (this.simulatedConflict) {
      const { conflictingEntities, nonConflictingCount } = extractConcurrencyConflicts(
        command.operations,
        this.currentLayers
      );
      return {
        success: false,
        errorType: "CONCURRENCY_CONFLICT",
        currentServerDraftVersion: this.simulatedConflict.serverVersion,
        conflictingEntities: this.simulatedConflict.conflictingEntities ?? conflictingEntities,
        nonConflictingOperationsCount: nonConflictingCount,
      };
    }

    if (command.baseDraftVersion !== this.adminDraft.draftVersion) {
      const { conflictingEntities, nonConflictingCount } = extractConcurrencyConflicts(
        command.operations,
        this.currentLayers
      );
      return {
        success: false,
        errorType: "CONCURRENCY_CONFLICT",
        currentServerDraftVersion: this.adminDraft.draftVersion,
        conflictingEntities,
        nonConflictingOperationsCount: nonConflictingCount,
      };
    }

    const nextLayers = structuredClone(this.currentLayers);
    const validation = validateDraftOperations(nextLayers, command.operations);
    if (validation) return validation;
    for (const op of command.operations) applyOperationToLayers(nextLayers, op);
    this.currentLayers = nextLayers;

    this.adminDraft.draftVersion += 1;
    this.adminDraft.updatedAt = new Date().toISOString();

    const result: SaveDraftResult = {
      success: true,
      newDraftVersion: this.adminDraft.draftVersion,
      updatedAt: this.adminDraft.updatedAt,
    };
    this.acceptedRequests.set(command.requestId, result);
    return structuredClone(result);
  }

  public async publishDraft(
    projectId: string,
    draftVersion: number
  ): Promise<PublishDraftResult> {
    void projectId;
    if (draftVersion !== this.adminDraft.draftVersion) {
      return {
        success: false,
        newPublishedVersionId: this.publishedVersionId,
        publishedAt: "",
        warnings: ["Draft version mismatch: server draft has been updated."],
      };
    }

    this.publishedVersionId = `pub-${Date.now()}`;
    this.publishedLayers = structuredClone(this.currentLayers);
    return {
      success: true,
      newPublishedVersionId: this.publishedVersionId,
      publishedAt: new Date().toISOString(),
    };
  }

  public async discardDraft(
    projectId: string,
    draftVersion: number
  ): Promise<DiscardDraftResult> {
    void projectId;
    void draftVersion;
    this.currentLayers = structuredClone(this.publishedLayers);
    this.adminDraft.draftVersion += 1;
    this.adminDraft.updatedAt = new Date().toISOString();
    return { success: true };
  }
}

// ============================================================================
// 8. HTTP Backend Client Adapter
// ============================================================================

export class HttpMapEditorApiClient implements MapEditorApiClient {
  private baseUrl: string;

  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (data?.success === false && typeof data?.errorType === "string") {
        return data as T;
      }
      throw new Error(data?.message ?? `Request failed (${response.status})`);
    }
    return data as T;
  }

  public async getMapEditorBootstrap(projectId: string): Promise<MapEditorBootstrap> {
    return this.fetchJson<MapEditorBootstrap>(
      `/api/map-editor/bootstrap?projectId=${encodeURIComponent(projectId)}`
    );
  }

  public async getEligibleUnattachedRecords(
    projectId: string,
    domain: "buildings" | "locations",
    searchQuery?: string
  ): Promise<EligibleUnattachedRecord[]> {
    const query = searchQuery ? `&searchQuery=${encodeURIComponent(searchQuery)}` : "";
    return this.fetchJson<EligibleUnattachedRecord[]>(
      `/api/map-editor/unattached-records?projectId=${encodeURIComponent(
        projectId
      )}&domain=${encodeURIComponent(domain)}${query}`
    );
  }

  public async saveDraft(command: SaveDraftCommand): Promise<SaveDraftResult>;
  public async saveDraft(projectId: string, baseDraftVersion: number, operations: WorkingOperation[]): Promise<SaveDraftResult>;
  public async saveDraft(
    commandOrProjectId: SaveDraftCommand | string,
    baseDraftVersion?: number,
    operations?: WorkingOperation[],
  ): Promise<SaveDraftResult> {
    const command: SaveDraftCommand = typeof commandOrProjectId === "string"
      ? { projectId: commandOrProjectId, baseDraftVersion: baseDraftVersion ?? 0, requestId: `legacy-${Date.now()}-${Math.random()}`, operations: operations ?? [] }
      : commandOrProjectId;
    return this.fetchJson<SaveDraftResult>("/api/map-editor/drafts/save", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  public async publishDraft(
    projectId: string,
    draftVersion: number
  ): Promise<PublishDraftResult> {
    return this.fetchJson<PublishDraftResult>("/api/map-editor/drafts/publish", {
      method: "POST",
      body: JSON.stringify({ projectId, draftVersion }),
    });
  }

  public async discardDraft(
    projectId: string,
    draftVersion: number
  ): Promise<DiscardDraftResult> {
    return this.fetchJson<DiscardDraftResult>("/api/map-editor/drafts/discard", {
      method: "POST",
      body: JSON.stringify({ projectId, draftVersion }),
    });
  }
}

// ============================================================================
// 9. Client Factory & Global Instance
// ============================================================================

export function createMapEditorApiClient(options?: {
  mode?: "local" | "mock" | "real";
  baseUrl?: string;
  seedSources?: RawSeedSources;
}): MapEditorApiClient {
  // Runtime always uses the real API. The dedicated test adapter flag is the
  // only supported way for a browser or unit-test harness to select fixtures.
  const mode = options?.mode ?? (import.meta.env.VITE_TEST_LOCAL_ADAPTER === "true" ? "local" : "real");
  if (mode === "real" || mode === "mock") {
    return new HttpMapEditorApiClient(options?.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000");
  }
  return new LocalMapEditorAdapter(options?.seedSources ? { seedSources: options.seedSources } : undefined);
}

export const mapEditorApiClient: MapEditorApiClient = createMapEditorApiClient();
