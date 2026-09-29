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
import type { SpatialDomain } from "../features/map/types";

export type { SpatialDomain };

// ============================================================================
// 1. Normalized Map Editor Entities
// ============================================================================

export interface BuildingEntity {
  id: string;
  name: string;
  code: string;
  status: "Active" | "Inactive" | "Open" | "Closed" | "Unknown";
  category?: string;
  type?: "Building" | "Facility";
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
  parentId?: string | null;
  spatialRole?: "building_footprint_owner";
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
  status: "Active" | "Open" | "Closed" | "Unknown";
  allowedModes?: Array<"Walking" | "Vehicle">;
  pathPoints: [number, number][];
  surface?: string;
  wheelchair?: boolean | string;
  isCovered?: boolean;
  sourceOsmNodeIds?: number[];
  sourceWayId?: number;
  source?: SourceProvenance;
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][]; // GeoJSON standard [lng, lat]
}

export interface MapEditorLayers {
  buildings: BuildingEntity[];
  outdoorLocations: OutdoorLocationEntity[];
  routeNodes: RouteNodeEntity[];
  pathways: PathwayEntity[];
}

// ============================================================================
// 2. Normalization Helpers
// ============================================================================

export interface RawSeedSources {
  buildings: Building[];
  locations: Location[];
  routeNodes: RouteNode[];
  pathways: Pathway[];
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
  const buildings: BuildingEntity[] = [];
  const outdoorLocations: OutdoorLocationEntity[] = [];
  const routeNodes: RouteNodeEntity[] = [];
  const pathways: PathwayEntity[] = [];

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

  // Normalize Buildings
  for (const bld of sources.buildings) {
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
      type: sources.locations.find((location) => location.id === bld.id)?.type === "Facility" ? "Facility" : "Building",
      entranceNodeIds,
      source: bld.source,
    });
  }

  // Keep footprint-backed Building/Facility Campus Locations in the building
  // layer. Legacy standalone Facilities remain readable as location records;
  // the Map Editor no longer offers a workflow that creates another one.
  for (const loc of sources.locations) {
    if (loc.type === "Building") continue;
    if (loc.type === "Facility" && (
      loc.spatialRole === "building_footprint_owner"
      || sources.buildings.some((building) => building.id === loc.id)
    )) continue;
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
      type: p.type ?? "Walkway",
      direction: p.direction ?? "Two-way",
      status: p.status ?? "Open",
      allowedModes: p.allowedModes ?? ["Walking"],
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
  };
}

