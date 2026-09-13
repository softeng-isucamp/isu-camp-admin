import { describe, expect, it, vi } from "vitest";
import type { Building, Location } from "../../../types";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapEditorApiClient";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { createBuildingFootprintWorkflow } from "./BuildingFootprintWorkflow";

const points: [number, number][] = [[0, 0], [0, 0.001], [0.001, 0]];
const identity = { name: "Science Hall", code: "SCI", function: "Teaching" };
const location: Location = {
  id: "building-42", name: "Science Hall", code: "SCI", type: "Building", parentId: null,
  status: "Active", lat: null, lng: null, positioned: false,
};
const building: Building = { id: location.id, name: location.name, code: location.code, points: [] };
const footprint: LocalMapFeatureEntity = {
  id: "footprint-1", family: "building_footprint", name: "Science Hall footprint",
  isEditable: true, status: "active", geometryType: "polygon", coordinates: points,
};
const link: FeatureLinkEntity = {
  id: "link-1", featureId: footprint.id, targetDomain: "Locations", targetEntityId: building.id,
  linkType: "building_footprint",
};
const context = { locations: [] as Location[], featureLinks: [] as FeatureLinkEntity[] };

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

  it("uses the persisted Building identity in one create batch", async () => {
    const workingSession = new WorkingSessionManager();
    workingSession.startDraft({ toolType: "polygon", label: "Building", provisionalGeometry: {} });
    const adapter = { createBuilding: vi.fn().mockResolvedValue(location), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "create", identity, points, context });

    expect(result).toMatchObject({
      ok: true,
      location: { id: "building-42" },
      building: { id: "building-42", points },
      operation: { type: "compound_batch" },
    });
    expect(result.ok && result.operation.nestedOperations?.map((item) => item.type)).toEqual([
      "create_entity", "create_entity", "link_feature",
    ]);
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

  it("persists an attachment before recording its footprint and link", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn().mockResolvedValue(undefined) };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({ kind: "attach", building, points, context });

    expect(adapter.saveFootprint).toHaveBeenCalledWith(building, points);
    expect(result.ok && result.operation.nestedOperations).toHaveLength(2);
    expect(result.ok && result.link.targetEntityId).toBe(building.id);
  });

  it("records a reshape as a geometry update", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn().mockResolvedValue(undefined) };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });
    const reshaped: [number, number][] = [[0, 0], [0, 0.002], [0.001, 0]];

    const result = await workflow.finalize({ kind: "reshape", building, footprint, link, points: reshaped, context });

    expect(result).toMatchObject({ ok: true, footprint: { coordinates: reshaped }, operation: { type: "update_geometry" } });
  });

  it("rejects a reshape with a stale ownership link", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });

    const result = await workflow.finalize({
      kind: "reshape", building, footprint, link: { ...link, featureId: "other" }, points, context,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(adapter.saveFootprint).not.toHaveBeenCalled();
  });

  it("rejects a linked feature that is not a Building Footprint polygon", async () => {
    const workingSession = new WorkingSessionManager();
    const adapter = { createBuilding: vi.fn(), saveFootprint: vi.fn() };
    const workflow = createBuildingFootprintWorkflow({ adapter, workingSession });
    const wrongFeature = { ...footprint, family: "parking_area" as const };

    const result = await workflow.finalize({
      kind: "reshape",
      building,
      footprint: wrongFeature,
      link: { ...link, featureId: wrongFeature.id },
      points,
      context,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(adapter.saveFootprint).not.toHaveBeenCalled();
  });
});
