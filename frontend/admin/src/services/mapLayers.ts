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
import type { LocalFeatureFamily, SpatialDomain } from "../features/map/types";

export type { LocalFeatureFamily, SpatialDomain };

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

export interface MapEditorLayers {
  buildings: BuildingEntity[];
  outdoorLocations: OutdoorLocationEntity[];
  routeNodes: RouteNodeEntity[];
  pathways: PathwayEntity[];
  localFeatures: LocalMapFeatureEntity[];
  featureLinks: FeatureLinkEntity[];
}

// ============================================================================
// 2. Normalization Helpers
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
      type: sources.locations.find((location) => location.id === bld.id)?.type === "Facility" ? "Facility" : "Building",
      linkedFeatureId: featureId,
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
    localFeatures,
    featureLinks,
  };
}

