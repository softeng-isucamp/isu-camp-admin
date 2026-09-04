import { describe, expect, it } from "vitest";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { polygonCentroid, polygonFeatureAnchor, polygonIsNonDegenerate, polygonSelfIntersects, reviewMapDraft, translatePolygon, validatePathwayDraft, validateRouteNodeDraft, withoutEndpointPathPoints } from "./mapEditing";
import { echagueCampusBoundary, pointInPolygon } from "./campusBoundary";

const location = (overrides: Partial<Location> = {}): Location => ({
  id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null,
  status: "Active", lat: 16.975, lng: 121.731, positioned: true, ...overrides,
});
const node = (overrides: Partial<RouteNode> = {}): RouteNode => ({
  id: "node-1", name: "Library entrance", nodeType: "Entrance",
  associatedPlaceId: "loc-1", lat: 16.975, lng: 121.731, ...overrides,
});
const pathway = (overrides: Partial<Pathway> = {}): Pathway => ({
  id: "path-1", name: "Library walk", sourceNodeId: "node-1", destinationNodeId: "node-2",
  distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway",
  direction: "Two-way", status: "Open", pathPoints: [[16.9751, 121.7311]], ...overrides,
});
const building = (overrides: Partial<Building> = {}): Building => ({
  id: "building-1", name: "Library", code: "LIB", points: [
    [16.975, 121.731], [16.976, 121.731], [16.976, 121.732],
  ], ...overrides,
});

describe("map draft review", () => {
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

  it("reports no pending changes for an unchanged map", () => {
    const result = reviewMapDraft({
      original: { locations: [location()], nodes: [node(), node({ id: "node-2" })], pathways: [pathway()], buildings: [building()] },
      current: { locations: [location()], nodes: [node(), node({ id: "node-2" })], pathways: [pathway()], buildings: [building()] },
      deleted: [],
    });
    expect(result).toEqual({ valid: true, errors: [], groups: [] });
  });

  it("groups added, moved, renamed, edited, and deleted objects", () => {
    const result = reviewMapDraft({
      original: { locations: [location()], nodes: [node(), node({ id: "node-2" })], pathways: [pathway()], buildings: [building()] },
      current: {
        locations: [location({ name: "Main Library", lat: 16.9752 })],
        nodes: [node({ name: "New entrance" }), node({ id: "node-2" }), node({ id: "node-3", name: "Ramp" })],
        pathways: [pathway({ pathPoints: [[16.9752, 121.7312]] })],
        buildings: [building()],
      },
      deleted: [{ type: "building", id: "building-old", label: "Old shed" }],
    });
    expect(result.groups.map((group) => group.kind)).toEqual(["added", "moved", "renamed", "deleted", "edited"]);
  });

  it("rejects invalid fields, geometry, self-connections, and duplicate pathways", () => {
    const result = reviewMapDraft({
      original: { locations: [], nodes: [], pathways: [], buildings: [] },
      current: {
        locations: [location({ name: " ", lat: 120 })],
        nodes: [node({ associatedPlaceId: "missing" }), node({ id: "node-2" })],
        pathways: [
          pathway({ sourceNodeId: "node-1", destinationNodeId: "node-1" }),
          pathway({ id: "path-2" }), pathway({ id: "path-3", sourceNodeId: "node-2", destinationNodeId: "node-1" }),
        ],
        buildings: [building({ points: [[16.975, 121.731], [16.976, 121.731]] })],
      },
      deleted: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message).join(" ")).toMatch(/name is required|latitude|associated Location|connects a Route Node to itself|duplicate|at least 3/i);
    expect(result.errors[0]).toMatchObject({ object: { type: "location", id: "loc-1" } });
  });

  it("requires outdoor Locations to be positioned for map readiness", () => {
    const unpositioned = location({ lat: null, lng: null, positioned: false });
    const result = reviewMapDraft({
      original: { locations: [unpositioned], nodes: [], pathways: [], buildings: [] },
      current: { locations: [unpositioned], nodes: [], pathways: [], buildings: [] },
      deleted: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{
      object: { type: "location", id: "loc-1", label: "Library" },
      message: "Outdoor Locations require latitude and longitude for map readiness.",
    }]);
  });

  it.each([
    ["Floor", { parentId: "building-1", building: "Library", lat: 16.975, lng: 121.731, positioned: true }],
    ["Room", { parentId: null, building: undefined, lat: null, lng: null, positioned: false }],
    ["Room", { parentId: "loc-1", building: "Library", lat: null, lng: null, positioned: false }],
    ["Room", { parentId: "building-1", building: "Library", lat: 16.975, lng: 121.731, positioned: true }],
  ] as const)("reports shared Location readiness issues for %s records", (type, overrides) => {
    const candidate = location({ type, ...overrides });
    const directory = type === "Floor" || overrides.parentId === "building-1"
      ? [candidate, location({ id: "building-1", name: "Library", type: "Building" })]
      : [candidate];
    const result = reviewMapDraft({
      original: { locations: directory, nodes: [], pathways: [], buildings: [] },
      current: { locations: directory, nodes: [], pathways: [], buildings: [] },
      deleted: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.object.id).toBe("loc-1");
    expect(result.errors[0]?.message).toMatch(/Building|unpositioned|coordinates|map/i);
  });

  it("rejects new or modified objects outside campus while allowing unchanged legacy data", () => {
    const result = reviewMapDraft({
      original: { locations: [location({ lat: 16.725 })], nodes: [node(), node({ id: "node-2" })], pathways: [pathway()], buildings: [building()] },
      current: { locations: [location({ lat: 16.725 })], nodes: [node(), node({ id: "node-2" })], pathways: [pathway({ pathPoints: [[16.725, 121.7311]] })], buildings: [building()] },
      deleted: [],
      campusBoundary: echagueCampusBoundary,
    });
    expect(result.errors.some((error) => /campus boundary/i.test(error.message))).toBe(true);
    expect(result.errors.some((error) => /campus boundary/i.test(error.message))).toBe(true);
    expect(result.errors.filter((error) => /campus boundary/i.test(error.message))).toHaveLength(1);
  });

  it("presents polygon overlap as an advisory review warning rather than a blocking failure", () => {
    const bld1 = building({
      id: "bld-1",
      name: "Engineering Hall",
      points: [[16.720, 121.689], [16.720, 121.691], [16.722, 121.691], [16.722, 121.689]],
    });
    const bld2 = building({
      id: "bld-2",
      name: "Science Annex",
      points: [[16.721, 121.690], [16.721, 121.692], [16.723, 121.692], [16.723, 121.690]],
    });
    const result = reviewMapDraft({
      original: { locations: [], nodes: [], pathways: [], buildings: [bld1] },
      current: { locations: [], nodes: [], pathways: [], buildings: [bld1, bld2] },
      deleted: [],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some((w) => w.message.includes("overlaps with"))).toBe(true);
  });
});
