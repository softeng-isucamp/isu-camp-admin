import { describe, expect, it } from "vitest";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { polygonCentroid, reviewMapDraft } from "./mapEditing";
import { echagueCampusBoundary } from "./campusBoundary";

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
  it("computes a building center marker from polygon vertices", () => {
    expect(polygonCentroid([[16, 121], [18, 121], [18, 123], [16, 123]])).toEqual([17, 122]);
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
    expect(result.errors.filter((error) => /campus boundary/i.test(error.message))).toHaveLength(1);
  });
});
