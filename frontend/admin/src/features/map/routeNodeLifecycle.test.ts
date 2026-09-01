import { describe, expect, it } from "vitest";
import type { Pathway, RouteNode } from "../../types";
import { deactivateRouteNode } from "./routeNodeLifecycle";

const node = (id: string): RouteNode => ({
  id,
  name: id,
  nodeType: "Junction",
  associatedPlaceId: null,
  lat: 16.72,
  lng: 121.69,
  status: "Active",
});

const pathway = (id: string, sourceNodeId: string, destinationNodeId: string): Pathway => ({
  id,
  name: id,
  sourceNodeId,
  destinationNodeId,
  pathPoints: [],
  distance: "—",
  time: "—",
  shade: "Unknown",
  type: "Walkway",
  direction: "Two-way",
  status: "Open",
});

describe("Route Node deactivation", () => {
  it("retires the node and cascades connected pathways", () => {
    const connected = [pathway("path-a", "node-a", "node-b"), pathway("path-b", "node-c", "node-a")];
    const result = deactivateRouteNode(node("node-a"), connected);

    expect(result.node.status).toBe("Inactive");
    expect(result.pathways).toEqual(connected);
    expect(result.operations.map((operation) => operation.type)).toEqual([
      "retire_entity",
      "retire_entity",
      "retire_entity",
    ]);
    expect(result.operations.slice(1).every((operation) => operation.after === null)).toBe(true);
  });
});
