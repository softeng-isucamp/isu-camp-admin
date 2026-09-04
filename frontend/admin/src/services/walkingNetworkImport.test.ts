import { describe, expect, it } from "vitest";
import type { NetworkSnapshot } from "./network";
import { previewWalkingNetworkImport } from "./walkingNetworkImport";

const snapshot: NetworkSnapshot = {
  buildings: [{ id: "building-library", name: "Library", code: "LIB", geometry: null, status: "active" }],
  routeNodes: [
    { id: "a", name: "A", latitude: 16.72, longitude: 121.68, status: "active", type: "junction", buildingId: null },
    { id: "b", name: "B", latitude: 16.721, longitude: 121.681, status: "active", type: "junction", buildingId: null },
  ],
  pathways: [],
};

describe("previewWalkingNetworkImport", () => {
  it("previews valid Pathways and Route Nodes as one set of draft operations", () => {
    const preview = previewWalkingNetworkImport(JSON.stringify([
      { entityType: "RouteNode", id: "c", name: "C", type: "junction", latitude: 16.722, longitude: 121.682 },
      { entityType: "Pathway", id: "p-c", name: "C Walk", sourceNodeId: "a", destinationNodeId: "b", pathPoints: [], type: "Campus walkway", direction: "two_way", status: "open", shade: "Fully Shaded", distanceMeters: 10, estimatedTimeSeconds: 60 },
    ]), snapshot);
    expect(preview.findings).toEqual([]);
    expect(preview.operations.map((operation) => operation.entityId)).toEqual(["c", "p-c"]);
  });

  it("resolves relationships within the batch regardless of row order", () => {
    const preview = previewWalkingNetworkImport(JSON.stringify([
      { entityType: "Pathway", id: "p-new", name: "New Walk", sourceNodeId: "a", destinationNodeId: "new-node", pathPoints: [], type: "walk", direction: "two_way", status: "open" },
      { entityType: "RouteNode", id: "new-node", name: "New Node", type: "junction", latitude: 16.722, longitude: 121.682 },
    ]), snapshot);

    expect(preview.findings).toEqual([
      expect.objectContaining({ severity: "advisory", entityId: "p-new" }),
    ]);
    expect(preview.operations.map((operation) => operation.entityId)).toEqual(["new-node", "p-new"]);
  });

  it("rejects self-links, missing nodes, Route records, and malformed geometry atomically", () => {
    const preview = previewWalkingNetworkImport(JSON.stringify([
      { kind: "Route", id: "route-1", pathwayIds: ["p-1"] },
      { entityType: "Pathway", id: "self", name: "Self", sourceNodeId: "a", destinationNodeId: "a", pathPoints: [], type: "walk", direction: "two_way", status: "open" },
      { entityType: "Pathway", id: "missing", name: "Missing", sourceNodeId: "a", destinationNodeId: "z", pathPoints: [], type: "walk", direction: "two_way", status: "open" },
    ]), snapshot);
    expect(preview.operations).toEqual([]);
    expect(preview.findings.every((finding) => finding.severity === "blocking")).toBe(true);
    expect(preview.findings.map((finding) => finding.message).join(" ")).toContain("Route records");
  });

  it("reports advisories for incomplete quality data and keeps them attached to objects", () => {
    const preview = previewWalkingNetworkImport(JSON.stringify({ entityType: "Pathway", id: "p-1", name: "Walk", sourceNodeId: "a", destinationNodeId: "b", pathPoints: [], type: "walk", direction: "two_way", status: "open" }), snapshot);
    expect(preview.operations).toHaveLength(1);
    expect(preview.findings).toEqual([expect.objectContaining({ severity: "advisory", entityId: "p-1" })]);
  });

  it("blocks an Entrance Route Node that references a missing Building", () => {
    const preview = previewWalkingNetworkImport(JSON.stringify({ entityType: "RouteNode", id: "entrance-1", name: "Unknown Entrance", type: "entrance", latitude: 16.722, longitude: 121.682, buildingId: "missing-building" }), snapshot);

    expect(preview.operations).toEqual([]);
    expect(preview.findings).toEqual([expect.objectContaining({ severity: "blocking", entityId: "entrance-1", message: expect.stringContaining("missing Building") })]);
  });
});
