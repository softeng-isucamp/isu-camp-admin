import { describe, expect, it } from "vitest";
import {
  createCampusBoundaryGeoJson,
  normalizeMapLayers,
  type RawSeedSources,
} from "./mapLayers";
import type { Building, Location, Pathway, RouteNode } from "../types";

const mockRawBuildings: Building[] = [
  {
    id: "bld-eng-01",
    name: "Engineering Complex",
    code: "ENG-MAIN",
    points: [
      [16.721, 121.689],
      [16.722, 121.689],
      [16.722, 121.69],
      [16.721, 121.69],
    ],
    status: "Active",
  },
  {
    id: "bld-unlinked-02",
    name: "New Agronomy Hall",
    code: "AGRO-01",
    points: [], // No geometry yet
    status: "Active",
  },
];

const mockRawLocations: Location[] = [
  {
    id: "loc-bld-rec",
    name: "Engineering Building Record",
    code: "ENG-REC",
    type: "Building",
    parentId: null,
    status: "Active",
    lat: 16.721,
    lng: 121.689,
    positioned: true,
  },
  {
    id: "loc-outdoor-pos",
    name: "Freedom Grandstand",
    code: "FGS-01",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: 16.7215,
    lng: 121.6895,
    positioned: true,
  },
  {
    id: "loc-outdoor-unpos",
    name: "Campus Quad Gazebo",
    code: "GAZ-01",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: null,
    lng: null,
    positioned: false,
  },
];

const mockRawRouteNodes: RouteNode[] = [
  {
    id: "node-ent-01",
    name: "Engineering Main Entrance",
    nodeType: "Entrance",
    associatedPlaceId: "bld-eng-01",
    lat: 16.721,
    lng: 121.689,
    status: "Active",
  },
  {
    id: "node-junc-02",
    name: "Central Plaza Junction",
    nodeType: "Junction",
    lat: 16.7215,
    lng: 121.6895,
    status: "Active",
  },
];

const mockRawPathways: Pathway[] = [
  {
    id: "path-01",
    name: "Engineering Walkway",
    sourceNodeId: "node-ent-01",
    destinationNodeId: "node-junc-02",
    distance: "65m",
    time: "1 min",
    shade: "Mostly Shaded",
    type: "Pedestrian Walkway",
    direction: "Two-way",
    status: "Open",
    pathPoints: [
      [16.721, 121.689],
      [16.7215, 121.6895],
    ],
  },
];

const mockSeedSources: RawSeedSources = {
  buildings: mockRawBuildings,
  locations: mockRawLocations,
  routeNodes: mockRawRouteNodes,
  pathways: mockRawPathways,
};

describe("normalizeMapLayers", () => {
  it("normalizes entities across all 6 spatial layers", () => {
    const layers = normalizeMapLayers(mockSeedSources);

    // 1. Buildings
    expect(layers.buildings).toHaveLength(2);
    const engBuilding = layers.buildings.find((b) => b.id === "bld-eng-01");
    expect(engBuilding).toBeDefined();
    expect(engBuilding?.name).toBe("Engineering Complex");
    expect(engBuilding?.linkedFeatureId).toBe("feat-poly-bld-eng-01");
    expect(engBuilding?.entranceNodeIds).toEqual(["node-ent-01"]);

    const unlinkedBuilding = layers.buildings.find((b) => b.id === "bld-unlinked-02");
    expect(unlinkedBuilding?.linkedFeatureId).toBeNull();
    expect(unlinkedBuilding?.entranceNodeIds).toEqual([]);

    // 2. Outdoor Locations (filters out type: 'Building')
    expect(layers.outdoorLocations).toHaveLength(2);
    expect(layers.outdoorLocations.some((l) => l.id === "loc-bld-rec")).toBe(false);
    const posLoc = layers.outdoorLocations.find((l) => l.id === "loc-outdoor-pos");
    expect(posLoc?.positioned).toBe(true);
    const unposLoc = layers.outdoorLocations.find((l) => l.id === "loc-outdoor-unpos");
    expect(unposLoc?.positioned).toBe(false);

    // 3. Route Nodes
    expect(layers.routeNodes).toHaveLength(2);
    const entNode = layers.routeNodes.find((n) => n.id === "node-ent-01");
    expect(entNode?.nodeType).toBe("Entrance");
    expect(entNode?.buildingId).toBe("bld-eng-01");

    // 4. Pathways
    expect(layers.pathways).toHaveLength(1);
    expect(layers.pathways[0].id).toBe("path-01");
    expect(layers.pathways[0].pathPoints).toEqual([
      [16.721, 121.689],
      [16.7215, 121.6895],
    ]);

    // 5. Local Map Features (includes seeded basemap, and building footprint)
    const footprint = layers.localFeatures.find((f) => f.id === "feat-poly-bld-eng-01");
    expect(footprint).toBeDefined();
    expect(footprint?.family).toBe("building_footprint");
    expect(footprint?.linkedBuildingId).toBe("bld-eng-01");
    expect(footprint?.coordinates).toEqual(mockRawBuildings[0].points);

    expect(layers.localFeatures.find((f) => f.family === "campus_boundary")).toBeUndefined();

    // 6. Feature Links
    expect(layers.featureLinks).toHaveLength(1);
    expect(layers.featureLinks[0]).toEqual({
      id: "link-bld-eng-01",
      featureId: "feat-poly-bld-eng-01",
      targetDomain: "Locations",
      targetEntityId: "bld-eng-01",
      linkType: "building_footprint",
      createdAt: "2026-08-15T00:00:00Z",
    });
  });

  it("constructs a valid closed GeoJSON polygon for campus boundary", () => {
    const geoJson = createCampusBoundaryGeoJson([
      [16.71, 121.68],
      [16.72, 121.69],
      [16.73, 121.68],
    ]);

    expect(geoJson.type).toBe("Polygon");
    expect(geoJson.coordinates).toHaveLength(1);
    const ring = geoJson.coordinates[0];
    expect(ring.length).toBe(4); // Closed ring (first === last)
    expect(ring[0]).toEqual([121.68, 16.71]); // [lng, lat] GeoJSON format
    expect(ring[ring.length - 1]).toEqual([121.68, 16.71]);
  });
});
