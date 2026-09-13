import { describe, expect, it, vi } from "vitest";
import type { Building, Location, RouteNode } from "../../../types";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { createRouteNodeWorkflow } from "./RouteNodeWorkflow";

const campusBoundary: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

const context = {
  buildings: [] as Building[],
  locations: [] as Location[],
  campusBoundary,
};

const routeNode = (overrides: Partial<RouteNode> = {}): RouteNode => ({
  id: "node-1",
  name: "Library Entrance",
  nodeType: "Entrance",
  associatedPlaceId: null,
  lat: 5,
  lng: 5,
  ...overrides,
});

describe("RouteNodeWorkflow", () => {
  it("rejects invalid drafts before persistence", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = {
      createRouteNode: vi.fn(),
      updateRouteNode: vi.fn(),
    };
    const workflow = createRouteNodeWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "create",
      draft: { ...routeNode({ name: "" }), id: undefined } as unknown as Omit<RouteNode, "id">,
      context,
    });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(adapter.createRouteNode).not.toHaveBeenCalled();
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("keeps the Tool Draft and history unchanged when persistence fails", async () => {
    const workingSession = new WorkingSessionManager();
    const draft = workingSession.startDraft({
      toolType: "point",
      label: "Route Node draft",
      provisionalGeometry: { points: [{ x: 5, y: 5 }] },
    });
    const adapter = {
      createRouteNode: vi.fn(),
      updateRouteNode: vi.fn().mockRejectedValue(new Error("Network unavailable")),
    };
    const workflow = createRouteNodeWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: routeNode(),
      after: routeNode({ name: "Renamed Entrance" }),
      context,
    });

    expect(result).toEqual({ ok: false, reason: "persistence", message: "Network unavailable" });
    expect(workingSession.getActiveDraft()).toEqual(draft);
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("records an authoritative create and completes the Tool Draft after persistence", async () => {
    const workingSession = new WorkingSessionManager();
    workingSession.startDraft({
      toolType: "point",
      label: "Route Node draft",
      provisionalGeometry: { points: [{ x: 5, y: 5 }] },
    });
    const confirmed = routeNode({ id: "node-42" });
    const adapter = {
      createRouteNode: vi.fn().mockResolvedValue(confirmed),
      updateRouteNode: vi.fn(),
    };
    const workflow = createRouteNodeWorkflow({ adapter, workingSession });

    const { id: _id, ...draft } = routeNode();
    const result = await workflow.finalize({ kind: "create", draft, context });

    expect(result).toMatchObject({ ok: true, node: confirmed });
    expect(workingSession.getActiveDraft()).toBeNull();
    expect(workingSession.getPastOperations()).toEqual([
      expect.objectContaining({
        type: "create_entity",
        domain: "Walking Network",
        entityId: "node-42",
        before: null,
        after: confirmed,
      }),
    ]);
  });

  it("distinguishes geometry updates from metadata updates", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = {
      createRouteNode: vi.fn(),
      updateRouteNode: vi.fn(async (node: RouteNode) => node),
    };
    const workflow = createRouteNodeWorkflow({ adapter, workingSession });

    await workflow.finalize({
      kind: "update",
      before: routeNode(),
      after: routeNode({ lat: 6, lng: 6 }),
      context,
    });
    await workflow.finalize({
      kind: "update",
      before: routeNode({ lat: 6, lng: 6 }),
      after: routeNode({ lat: 6, lng: 6, name: "East Entrance" }),
      context,
    });

    expect(workingSession.getPastOperations().map((operation) => operation.type)).toEqual([
      "update_geometry",
      "update_properties",
    ]);
  });

  it("rejects an update whose identity changed", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = {
      createRouteNode: vi.fn(),
      updateRouteNode: vi.fn(),
    };
    const workflow = createRouteNodeWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: routeNode(),
      after: routeNode({ id: "node-2" }),
      context,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(adapter.updateRouteNode).not.toHaveBeenCalled();
  });
});
