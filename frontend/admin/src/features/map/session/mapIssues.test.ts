import { describe, expect, it, vi } from "vitest";
import type { BackendLocationType } from "../../../lib/locationPolicy";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { echagueCampusBoundary } from "../campusBoundary";
import type { PathwayCrossing } from "../pathway/pathwayTopology";
import { deriveMapIssues, type MapIssueSources } from "./mapIssues";

const INSIDE: [number, number] = [16.7205, 121.6895];
const OUTSIDE: [number, number] = [10, 100];

const building = (id: string, name: string, overrides: Partial<Building> = {}): Building => ({
  id,
  name,
  code: id.toUpperCase(),
  points: [[16.72, 121.689], [16.721, 121.689], [16.721, 121.69]],
  ...overrides,
});
const entrance = (id: string, placeId: string | null, overrides: Partial<RouteNode> = {}): RouteNode => ({
  id,
  name: id,
  nodeType: "Entrance",
  associatedPlaceId: placeId,
  lat: INSIDE[0],
  lng: INSIDE[1],
  ...overrides,
});
const location = (id: string, option: BackendLocationType, overrides: Partial<Location> = {}): Location => ({
  id,
  name: `${option} ${id}`,
  code: id,
  ...(option === "Building" || option === "Facility" ? { type: "Place" as const, classification: option } : { type: option }),
  parentId: null,
  status: "Active",
  lat: INSIDE[0],
  lng: INSIDE[1],
  positioned: true,
  ...overrides,
});
const pathway = (id: string, name: string, overrides: Partial<Pathway> = {}): Pathway => ({
  id,
  name,
  sourceNodeId: "node-a",
  destinationNodeId: "node-b",
  shade: "Unknown",
  type: "Walkway",
  direction: "Two-way",
  status: "Open",
  pathPoints: [],
  ...overrides,
});
const crossing = (a: string, b: string, latitude = 16.7205, longitude = 121.6895): PathwayCrossing => ({
  pathwayAId: a,
  pathwayBId: b,
  point: { latitude, longitude },
});

const derive = (objects: Partial<MapIssueSources> = {}, fixCrossing: (crossing: PathwayCrossing) => void = vi.fn()) =>
  deriveMapIssues(
    { buildings: [], locations: [], nodes: [], pathways: [], pathwayCrossings: [], ...objects },
    echagueCampusBoundary,
    fixCrossing,
  );

describe("deriveMapIssues", () => {
  it("reports nothing for clean data", () => {
    expect(derive({
      buildings: [building("b1", "Library")],
      nodes: [entrance("e1", "b1")],
      locations: [location("l1", "Facility")],
    })).toEqual([]);
  });

  it("lists one row per pathway crossing and fixes the crossing it belongs to", () => {
    const fixCrossing = vi.fn();
    const first = crossing("p1", "p2");
    const second = crossing("p1", "p3", 16.7206, 121.6896);
    const issues = derive({
      pathways: [pathway("p1", "Main Road"), pathway("p2", "Gym Walkway"), pathway("p3", "")],
      pathwayCrossings: [first, second],
    }, fixCrossing);

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      kind: "pathway-crossing",
      title: "Main Road × Gym Walkway",
      detail: "Not routable",
      point: [16.7205, 121.6895],
      selection: null,
    });
    expect(issues[1].title).toBe("Main Road × p3");
    expect(issues[0].id).not.toBe(issues[1].id);

    issues[1].action?.onClick();
    expect(fixCrossing).toHaveBeenCalledExactlyOnceWith(second);
    expect(issues[0].action).toMatchObject({
      label: "Create Junction & Split Pathway: Main Road × Gym Walkway",
      shortLabel: "Create Junction",
    });
  });

  it("keeps a crossing's id stable when an earlier crossing is fixed", () => {
    const pathways = [pathway("p1", "A"), pathway("p2", "B"), pathway("p3", "C")];
    const second = crossing("p1", "p3", 16.7206, 121.6896);
    const before = derive({ pathways, pathwayCrossings: [crossing("p1", "p2"), second] });
    const after = derive({ pathways, pathwayCrossings: [second] });

    expect(after[0].id).toBe(before[1].id);
  });

  it("lists every building without an active Entrance, even one with only an inactive Entrance", () => {
    const issues = derive({
      buildings: [
        building("bare", "Bare Hall"),
        building("retired", "Retired Entrance Hall"),
        building("ok", "Open Hall"),
        building("linked", "Linked Hall"),
      ],
      locations: [location("linked-location", "Building", { name: "Linked Hall" })],
      nodes: [
        entrance("e-retired", "retired", { status: "Inactive" }),
        entrance("e-ok", "ok"),
        entrance("e-junction", "bare", { nodeType: "Junction" }),
        // Entrances placed from the inspector associate with the Location when the Building has one.
        entrance("e-linked", "linked-location"),
      ],
    });

    expect(issues.map((issue) => issue.title)).toEqual(["Bare Hall", "Retired Entrance Hall"]);
    expect(issues[0]).toMatchObject({
      kind: "no-entrance",
      detail: "0 entrance nodes",
      selection: { type: "building", id: "bare" },
    });
  });

  it("skips inactive buildings and buildings without a footprint", () => {
    expect(derive({
      buildings: [
        building("gone", "Closed Hall", { status: "Inactive" }),
        building("flat", "Flat", { points: [[16.72, 121.689], [16.721, 121.689]] }),
      ],
    })).toEqual([]);
  });

  it("gives only crossings an action; objects are fixed from their inspector", () => {
    const issues = derive({
      buildings: [building("b1", "Hall"), building("far", "Far Hall", { points: [[10, 100], [10.1, 100], [10.1, 100.1]] })],
      pathways: [pathway("p1", "A"), pathway("p2", "B")],
      pathwayCrossings: [crossing("p1", "p2")],
    });

    expect(issues.map((issue) => [issue.kind, issue.action !== undefined])).toEqual([
      ["pathway-crossing", true],
      ["no-entrance", false],
      ["no-entrance", false],
      ["outside-boundary", false],
    ]);
  });

  it("reports every kind of object outside the campus boundary", () => {
    const issues = derive({
      buildings: [building("far", "Far Hall", { points: [[10, 100], [10.1, 100], [10.1, 100.1]] })],
      locations: [location("l1", "Facility", { name: "Far Facility", lat: OUTSIDE[0], lng: OUTSIDE[1] })],
      nodes: [
        entrance("far-node", null, { name: "Far Node", lat: OUTSIDE[0], lng: OUTSIDE[1] }),
        entrance("near-node", null),
      ],
      pathways: [pathway("far-path", "Far Path", { pathPoints: [OUTSIDE] })],
    });
    const outside = issues.filter((issue) => issue.kind === "outside-boundary");

    expect(outside.map((issue) => [issue.title, issue.detail])).toEqual([
      ["Far Facility", "Facility"],
      ["Far Node", "Route Node"],
      ["Far Path", "Pathway"],
      ["Far Hall", "Building"],
    ]);
    expect(outside.map((issue) => issue.selection)).toEqual([
      { type: "location", id: "l1", locationType: "Place" },
      { type: "node", id: "far-node" },
      { type: "pathway", id: "far-path" },
      { type: "building", id: "far" },
    ]);
    expect(outside[1].point).toEqual(OUTSIDE);
    expect(outside.every((issue) => issue.action === undefined)).toBe(true);
  });

  it("ignores unpositioned locations when checking the boundary", () => {
    expect(derive({
      locations: [location("room", "Room", { lat: null, lng: null, positioned: false })],
    })).toEqual([]);
  });

  it("scopes identity by type: a Building and a Room sharing an ID are separate rows", () => {
    const issues = derive({
      locations: [
        location("same", "Building", { lat: OUTSIDE[0], lng: OUTSIDE[1] }),
        location("same", "Room", { lat: OUTSIDE[0], lng: OUTSIDE[1] }),
      ],
    });

    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(2);
    expect(issues.map((issue) => issue.selection)).toEqual([
      { type: "location", id: "same", locationType: "Place" },
      { type: "location", id: "same", locationType: "Room" },
    ]);
  });

  it("orders alerts first, then by kind, keeping data order within a kind", () => {
    const issues = derive({
      buildings: [building("b1", "Bare One"), building("b2", "Bare Two")],
      nodes: [entrance("far-node", null, { name: "Far Node", lat: OUTSIDE[0], lng: OUTSIDE[1] })],
      pathways: [pathway("p1", "A"), pathway("p2", "B")],
      pathwayCrossings: [crossing("p1", "p2")],
    });

    expect(issues.map((issue) => issue.kind)).toEqual([
      "pathway-crossing",
      "no-entrance",
      "no-entrance",
      "outside-boundary",
    ]);
    expect(issues.slice(1, 3).map((issue) => issue.title)).toEqual(["Bare One", "Bare Two"]);
  });
});
