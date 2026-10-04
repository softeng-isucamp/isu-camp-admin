import { describe, expect, it } from "vitest";
import type { Building, Pathway, RouteNode } from "../../types";
import { pathwayWithSuggestedName, polygonCentroid, polygonFeatureAnchor, polygonIsNonDegenerate, polygonSelfIntersects, suggestedPathwayName, translatePolygon, validatePathwayDraft, validateRouteNodeDraft, withoutEndpointPathPoints } from "./mapEditing";
import { pointInPolygon } from "./campusBoundary";

const node = (overrides: Partial<RouteNode> = {}): RouteNode => ({
  id: "node-1", name: "Library entrance", nodeType: "Entrance",
  associatedPlaceId: "loc-1", lat: 16.975, lng: 121.731, ...overrides,
});
const pathway = (overrides: Partial<Pathway> = {}): Pathway => ({
  id: "path-1", name: "Library walk", sourceNodeId: "node-1", destinationNodeId: "node-2", shade: "Mostly Shaded", type: "Walkway",
  direction: "Two-way", status: "Open", pathPoints: [[16.9751, 121.7311]], ...overrides,
});
const building = (overrides: Partial<Building> = {}): Building => ({
  id: "building-1", name: "Library", code: "LIB", points: [
    [16.975, 121.731], [16.976, 121.731], [16.976, 121.732],
  ], ...overrides,
});

describe("map draft review", () => {
  it("suggests a pathway name from its endpoint names and preserves custom names", () => {
    const destination = node({ id: "node-2", name: "Central Quad Junction", nodeType: "Junction", associatedPlaceId: null });
    const unnamed = pathway({ name: "", destinationNodeId: destination.id });
    expect(suggestedPathwayName(unnamed, [node(), destination])).toBe("Central Quad Junction – Library entrance");
    expect(suggestedPathwayName({ ...unnamed, sourceNodeId: destination.id, destinationNodeId: node().id }, [node(), destination])).toBe("Central Quad Junction – Library entrance");
    expect(pathwayWithSuggestedName(unnamed, [node(), destination]).name).toBe("Central Quad Junction – Library entrance");
    expect(pathwayWithSuggestedName(pathway({ name: "Main Gate – Library" }), [node(), destination]).name).toBe("Main Gate – Library");
    expect(suggestedPathwayName(unnamed, [node()])).toBe("");
  });

  it("validates Route Node metadata, campus placement, and Entrance associations", () => {
    const campus = [[0, 0], [0, 10], [10, 10], [10, 0]] as [number, number][];
    const buildings = [building({ id: "building-1" })];
    const validNode = { ...node(), lat: 5, lng: 5 };
    expect(validateRouteNodeDraft({ ...validNode, associatedPlaceId: "building-1" }, { buildings, campusBoundary: campus })).toEqual([]);
    expect(validateRouteNodeDraft({ ...validNode, nodeType: "Junction", associatedPlaceId: "building-1" }, { buildings, campusBoundary: campus })).toEqual([
      { field: "association", message: "Only Entrance Route Nodes may have a Building association." },
    ]);
    expect(validateRouteNodeDraft({ ...validNode, associatedPlaceId: null, lat: Number.NaN }, { buildings, campusBoundary: campus })).toEqual([
      { field: "coordinate", message: "Route Node latitude and longitude must be valid finite coordinates." },
    ]);
    expect(validateRouteNodeDraft({ ...validNode, associatedPlaceId: "missing" }, { buildings, campusBoundary: campus })).toEqual([
      { field: "association", message: "Associated Building does not exist." },
    ]);
  });

  it("detects a bow-tie polygon while allowing a normal footprint", () => {
    expect(polygonSelfIntersects([[0, 0], [1, 1], [0, 1], [1, 0]])).toBe(true);
    expect(polygonSelfIntersects([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });

  it("translates every footprint vertex by one shared delta", () => {
    expect(translatePolygon([[1, 2], [3, 2], [3, 4]], [10, 20])).toEqual([[11, 22], [13, 22], [13, 24]]);
  });

  it("uses an internal point as the derived Feature Anchor", () => {
    expect(polygonFeatureAnchor([[0, 0], [0, 4], [2, 4], [2, 0]])).toEqual([1, 2]);
    const concave: [number, number][] = [
      [0, 0], [0, 4], [4, 4], [4, 3], [1, 3], [1, 1], [4, 1], [4, 0],
    ];
    expect(pointInPolygon(polygonFeatureAnchor(concave), concave)).toBe(true);
  });

  it("rejects polygons whose distinct vertices are collinear", () => {
    expect(polygonIsNonDegenerate([[0, 0], [1, 1], [2, 2]])).toBe(false);
    expect(polygonIsNonDegenerate([[0, 0], [0, 1], [1, 0]])).toBe(true);
  });

  it("computes a building center marker from polygon vertices", () => {
    expect(polygonCentroid([[16, 121], [18, 121], [18, 123], [16, 123]])).toEqual([17, 122]);
  });

  it("keeps pathway endpoints out of intermediate Path Points", () => {
    expect(withoutEndpointPathPoints([
      [1, 1], [1.5, 1.5], [2, 2], [1, 1],
    ], [1, 1], [2, 2])).toEqual([[1.5, 1.5]]);
  });

  it("identifies the ordered Path Point and blocks invalid coordinates", () => {
    const invalid = pathway({ pathPoints: [[91, 121.7311], [91, 121.7311]] });
    const issues = validatePathwayDraft(invalid, [node(), node({ id: "node-2", lat: 16.976, lng: 121.732 })]);
    expect(issues).toEqual(expect.arrayContaining([
      { field: "pathPoint", message: "Path Point #1 must use a valid latitude and longitude." },
      { field: "sequence", message: "Path Sequence contains duplicate consecutive points at #1 and #2." },
    ]));
  });

  it("accepts a valid Pathway draft with distinct endpoints", () => {
    expect(validatePathwayDraft(
      pathway(),
      [node(), node({ id: "node-2", lat: 16.976, lng: 121.732 })],
    )).toEqual([]);
  });

  it("keeps Walkways walking-only while allowing Roads to opt into Vehicle mode", () => {
    const nodes = [node(), node({ id: "node-2", lat: 16.976, lng: 121.732 })];
    expect(validatePathwayDraft(pathway({ allowedModes: ["Walking", "Vehicle"] }), nodes)).toEqual([
      { field: "allowedModes", message: "Walkways cannot allow Vehicle mode." },
    ]);
    expect(validatePathwayDraft(pathway({ type: "Road", allowedModes: ["Walking", "Vehicle"] }), nodes)).toEqual([]);
  });
});
