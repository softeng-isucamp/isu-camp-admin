import { describe, expect, it } from "vitest";
import type { Building, Pathway, RouteNode } from "../../types";
import { buildLifecycleChange, calculateLifecycleImpact } from "./routeNodeLifecycle";

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

describe("Walking Network lifecycle", () => {
  it("deactivates only the node and preserves connected pathways", () => {
    const connected = [pathway("path-a", "node-a", "node-b"), pathway("path-b", "node-c", "node-a")];
    const result = buildLifecycleChange("deactivate_node", node("node-a"));

    expect(result.record.status).toBe("Inactive");
    expect(result.operation.type).toBe("retire_entity");
    expect(result.operation.after).toMatchObject({ id: "node-a", status: "Inactive" });
    expect(connected).toHaveLength(2);
  });

  it("reports a Building losing routability when its only entrance pathway closes", () => {
    const building: Building = { id: "building-a", name: "Library", code: "LIB", points: [] };
    const entrance = { ...node("node-a"), nodeType: "Entrance" as const, associatedPlaceId: building.id };
    const path = pathway("path-a", "node-a", "node-b");
    const impact = calculateLifecycleImpact({ action: "close_pathway", object: path, pathways: [path], nodes: [entrance, node("node-b")], buildings: [building] });

    expect(impact.connectedPathways).toEqual([path]);
    expect(impact.affectedEntrances).toEqual([entrance]);
    expect(impact.buildingsLosingRoutability).toEqual([building]);
  });

  it("reopening a pathway produces a restorable identity-preserving operation", () => {
    const original = pathway("path-a", "node-a", "node-b");
    const closed = { ...original, status: "Closed" as const, pathPoints: [[16.72, 121.69] as [number, number]] };
    const result = buildLifecycleChange("reopen_pathway", closed);

    expect(result.operation.type).toBe("restore_entity");
    expect(result.record).toEqual({ ...closed, status: "Open" });
    expect(result.record.pathPoints).toEqual(closed.pathPoints);
  });
});
