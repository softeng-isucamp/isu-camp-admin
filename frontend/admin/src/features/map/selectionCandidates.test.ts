import { describe, expect, it } from "vitest";
import type { Building, Pathway, RouteNode } from "../../types";
import { findSelectionCandidates } from "./selectionCandidates";

const nodes: RouteNode[] = [
  { id: "node-a", name: "West", nodeType: "Junction", lat: 16.72, lng: 121.689 },
  { id: "node-b", name: "East", nodeType: "Junction", lat: 16.72, lng: 121.69 },
];

const pathway: Pathway = {
  id: "path-1",
  name: "Library Walk",
  sourceNodeId: "node-a",
  destinationNodeId: "node-b",
  distance: "100 m",
  time: "1 min",
  shade: "Unknown",
  type: "Walkway",
  direction: "Two-way",
  status: "Active",
  pathPoints: [],
};

const building: Building = {
  id: "building-1",
  name: "Library",
  code: "LIB",
  points: [
    [16.7198, 121.6892],
    [16.7202, 121.6892],
    [16.7202, 121.6898],
    [16.7198, 121.6898],
  ],
};

describe("findSelectionCandidates", () => {
  it("includes a Pathway clicked near the middle of a segment", () => {
    const candidates = findSelectionCandidates([16.72001, 121.6895], {
      locations: [],
      nodes,
      pathways: [pathway],
      buildings: [],
    });

    expect(candidates).toContainEqual(expect.objectContaining({ id: "path-1", type: "pathway" }));
  });

  it("includes a Building clicked inside its footprint away from every vertex", () => {
    const candidates = findSelectionCandidates([16.72, 121.6895], {
      locations: [],
      nodes: [],
      pathways: [],
      buildings: [building],
    });

    expect(candidates).toContainEqual(expect.objectContaining({ id: "building-1", type: "building" }));
  });

  it("returns both overlapping area and line features for disambiguation", () => {
    const candidates = findSelectionCandidates([16.72, 121.6895], {
      locations: [],
      nodes,
      pathways: [pathway],
      buildings: [building],
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "path-1", type: "pathway" }),
      expect.objectContaining({ id: "building-1", type: "building" }),
    ]));
    expect(candidates).toHaveLength(2);
  });
});
