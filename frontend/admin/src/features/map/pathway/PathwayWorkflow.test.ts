import { describe, expect, it, vi } from "vitest";
import type { Pathway, RouteNode } from "../../../types";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { createPathwayWorkflow } from "./PathwayWorkflow";

const nodes: RouteNode[] = [
  { id: "node-1", name: "North Entrance", nodeType: "Entrance", lat: 0, lng: 0, status: "Active" },
  { id: "node-2", name: "Library Junction", nodeType: "Junction", lat: 0, lng: 0.001, status: "Active" },
];

const pathway = (overrides: Partial<Pathway> = {}): Pathway => ({
  id: "path-1",
  name: "Library Walk",
  sourceNodeId: "node-1",
  destinationNodeId: "node-2",
  distance: "111 m",
  time: "2 min",
  shade: "Unshaded",
  type: "Walkway",
  direction: "Two-way",
  status: "Active",
  allowedModes: ["Walking"],
  pathPoints: [],
  ...overrides,
});

const context = { nodes, existingPathways: [] as Pathway[] };

describe("PathwayWorkflow", () => {
  it("rejects invalid Pathways before persistence", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createPathway: vi.fn(), updatePathway: vi.fn() };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "create",
      draft: pathway({ destinationNodeId: "node-1" }),
      context,
    });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(adapter.createPathway).not.toHaveBeenCalled();
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("keeps the Tool Draft and history when persistence fails", async () => {
    const workingSession = new WorkingSessionManager();
    const draft = workingSession.startDraft({
      toolType: "pathway",
      label: "Pathway draft",
      provisionalGeometry: {},
    });
    const adapter = {
      createPathway: vi.fn(),
      updatePathway: vi.fn().mockRejectedValue(new Error("Network unavailable")),
    };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: pathway(),
      after: pathway({ name: "Library Promenade" }),
      context,
    });

    expect(result).toEqual({ ok: false, reason: "persistence", message: "Network unavailable" });
    expect(workingSession.getActiveDraft()).toEqual(draft);
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("records an authoritative create and completes the Tool Draft", async () => {
    const workingSession = new WorkingSessionManager();
    workingSession.startDraft({ toolType: "pathway", label: "Pathway draft", provisionalGeometry: {} });
    const confirmed = pathway({ id: "path-42", distance: "112 m" });
    const adapter = {
      createPathway: vi.fn().mockResolvedValue(confirmed),
      updatePathway: vi.fn(),
    };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "create", draft: pathway({ id: "pending-path" }), context });

    expect(result).toMatchObject({ ok: true, pathway: confirmed, operation: { type: "create_entity", entityId: "path-42" } });
    expect(workingSession.getActiveDraft()).toBeNull();
  });

  it("strips endpoint points and recomputes metrics before persistence", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = {
      createPathway: vi.fn(),
      updatePathway: vi.fn(async (value: Pathway) => value),
    };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: pathway(),
      after: pathway({ pathPoints: [[0, 0], [0, 0.0005], [0, 0.001]] }),
      context,
    });

    expect(result.ok && result.pathway.pathPoints).toEqual([[0, 0.0005]]);
    expect(result.ok && result.operation.type).toBe("update_geometry");
    expect(adapter.updatePathway).toHaveBeenCalledWith(expect.objectContaining({ distance: "111 m", time: "2 min" }));
  });

  it("records metadata and geometry together as one compound operation", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = {
      createPathway: vi.fn(),
      updatePathway: vi.fn(async (value: Pathway) => value),
    };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: pathway(),
      after: pathway({ name: "Covered Walk", pathPoints: [[0, 0.0005]] }),
      context,
    });

    expect(result.ok && result.operation).toMatchObject({ type: "compound_batch", nestedOperations: [{ type: "update_properties" }, { type: "update_geometry" }] });
    expect(workingSession.getPastOperations()).toHaveLength(1);
  });

  it("rejects an update whose identity changed", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createPathway: vi.fn(), updatePathway: vi.fn() };
    const workflow = createPathwayWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "update",
      before: pathway(),
      after: pathway({ id: "path-2" }),
      context,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(adapter.updatePathway).not.toHaveBeenCalled();
  });
});
