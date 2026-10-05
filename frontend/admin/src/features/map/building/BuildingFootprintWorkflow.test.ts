import { describe, expect, it, vi } from "vitest";
import type { Building, Location } from "../../../types";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { createBuildingFootprintWorkflow } from "./BuildingFootprintWorkflow";

const points: [number, number][] = [[0, 0], [0, 0.001], [0.001, 0]];
const identity = { name: "Science Hall", code: "SCI", function: "Teaching" };
const location: Location = {
  id: "building-42", name: "Science Hall", code: "SCI", type: "Building", parentId: null,
  status: "Active", lat: null, lng: null, positioned: false,
};
const building: Building = { id: location.id, name: location.name, code: location.code, points: [] };
const context = { locations: [] as Location[] };

describe("BuildingFootprintWorkflow", () => {
  it("rejects invalid geometry before persistence", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "create", identity, points: points.slice(0, 2), context });

    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(adapter.createBuilding).not.toHaveBeenCalled();
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("uses the persisted Building identity in the create record", async () => {
    const workingSession = new WorkingSessionManager();
    workingSession.startDraft({ toolType: "polygon", label: "Building", provisionalGeometry: {} });
    const adapter = { createBuilding: vi.fn().mockResolvedValue(location), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "create", identity, points, context });

    expect(result).toMatchObject({
      ok: true,
      location: { id: "building-42" },
      building: { id: "building-42", points },
      operation: { type: "create_entity", domain: "Locations", entityId: "building-42" },
    });
    expect(workingSession.getActiveDraft()).toBeNull();
  });

  it("keeps the polygon Tool Draft and history when persistence fails", async () => {
    const workingSession = new WorkingSessionManager();
    const draft = workingSession.startDraft({ toolType: "polygon", label: "Building", provisionalGeometry: {} });
    const adapter = { createBuilding: vi.fn().mockRejectedValue(new Error("Offline")), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "create", identity, points, context });

    expect(result).toEqual({ ok: false, reason: "persistence", message: "Offline" });
    expect(workingSession.getActiveDraft()).toEqual(draft);
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("records a reshape as a geometry update", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn().mockResolvedValue(undefined) };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });
    const reshaped: [number, number][] = [[0, 0], [0, 0.002], [0.001, 0]];
    const shaped: Building = { ...building, points };

    const result = await workflow.finalize({ kind: "reshape", building: shaped, points: reshaped, context });

    expect(adapter.saveFootprint).toHaveBeenCalledWith(shaped, reshaped);
    expect(result).toMatchObject({ ok: true, building: { points: reshaped }, operation: { type: "update_geometry" } });
  });
});
