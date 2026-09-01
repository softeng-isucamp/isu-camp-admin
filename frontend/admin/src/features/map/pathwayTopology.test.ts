import { describe, expect, it } from "vitest";
import type { Pathway, RouteNode } from "../../types";
import {
  createJunctionSplit,
  findPathwayCrossings,
  insertPathPointAtSegmentMidpoint,
  pathwayConnectionError,
} from "./pathwayTopology";
import { createRoutableCrossing } from "./pathwayCommands";

const pathway = (overrides: Partial<Pathway> = {}): Pathway => ({
  id: "path-ab",
  name: "A–B Walk",
  sourceNodeId: "node-a",
  destinationNodeId: "node-b",
  distance: "10 m",
  time: "1 min",
  shade: "Unknown",
  type: "Campus walkway",
  direction: "Two-way",
  status: "Open",
  pathPoints: [],
  ...overrides,
});

const nodes: RouteNode[] = [
  { id: "node-a", name: "A", nodeType: "Junction", lat: 0, lng: 0 },
  { id: "node-b", name: "B", nodeType: "Junction", lat: 2, lng: 2 },
  { id: "node-c", name: "C", nodeType: "Junction", lat: 0, lng: 2 },
  { id: "node-d", name: "D", nodeType: "Junction", lat: 2, lng: 0 },
];

describe("pathway topology", () => {
  it("rejects identical endpoints and existing undirected direct connections", () => {
    expect(pathwayConnectionError("node-a", "node-a", [])).toBe(
      "A Pathway must connect two distinct Route Nodes.",
    );
    expect(pathwayConnectionError("node-b", "node-a", [pathway({ status: "Closed" })])).toBe(
      "A direct Pathway already connects these Route Nodes.",
    );
    expect(pathwayConnectionError("node-a", "node-c", [pathway()])).toBeNull();
  });

  it("inserts a subordinate Path Point at the selected segment midpoint", () => {
    expect(insertPathPointAtSegmentMidpoint([
      { latitude: 0, longitude: 0 },
      { latitude: 2, longitude: 2 },
    ], 0)).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    ]);
  });

  it("finds interior visual crossings without treating endpoints as implicit junctions", () => {
    const crossings = findPathwayCrossings(
      [pathway(), pathway({ id: "path-cd", sourceNodeId: "node-c", destinationNodeId: "node-d" })],
      nodes,
    );
    expect(crossings).toEqual([{ pathwayAId: "path-ab", pathwayBId: "path-cd", point: { latitude: 1, longitude: 1 } }]);
  });

  it("detects a crossing at a subordinate Path Point", () => {
    const crossingNodes: RouteNode[] = [
      { id: "node-a", name: "A", nodeType: "Junction", lat: 0, lng: 0 },
      { id: "node-b", name: "B", nodeType: "Junction", lat: 2, lng: 0 },
      { id: "node-c", name: "C", nodeType: "Junction", lat: 1, lng: -1 },
      { id: "node-d", name: "D", nodeType: "Junction", lat: 1, lng: 1 },
    ];
    expect(findPathwayCrossings([
      pathway({ pathPoints: [[1, 0]] }),
      pathway({ id: "path-cd", sourceNodeId: "node-c", destinationNodeId: "node-d" }),
    ], crossingNodes)).toEqual([
      { pathwayAId: "path-ab", pathwayBId: "path-cd", point: { latitude: 1, longitude: 0 } },
    ]);
  });

  it("creates one Junction and two replacement Pathways for an atomic split", () => {
    const result = createJunctionSplit(pathway(), nodes, { latitude: 1, longitude: 1 }, "junction-1");

    expect(result.junction).toMatchObject({ id: "junction-1", nodeType: "Junction", lat: 1, lng: 1 });
    expect(result.pathways).toEqual([
      expect.objectContaining({ id: "path-ab-a", sourceNodeId: "node-a", destinationNodeId: "junction-1" }),
      expect.objectContaining({ id: "path-ab-b", sourceNodeId: "junction-1", destinationNodeId: "node-b" }),
    ]);
    expect(result.pathways.flatMap((item) => item.pathPoints)).toEqual([]);
  });

  it("splits both crossing Pathways around one shared Junction in one compound operation", () => {
    const result = createRoutableCrossing(
      pathway(),
      pathway({ id: "path-cd", sourceNodeId: "node-c", destinationNodeId: "node-d" }),
      nodes,
      { latitude: 1, longitude: 1 },
      "junction-1",
    );

    expect(result.replacementPathways).toHaveLength(4);
    expect(result.replacementPathways.filter((item) =>
      item.sourceNodeId === "junction-1" || item.destinationNodeId === "junction-1",
    )).toHaveLength(4);
    expect(result.operations).toHaveLength(7);
  });
});
