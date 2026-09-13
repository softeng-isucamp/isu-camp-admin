import { describe, expect, it } from "vitest";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapEditorApiClient";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { createLocalMapFeatureWorkflow } from "./LocalMapFeatureWorkflow";

const feature = (overrides: Partial<LocalMapFeatureEntity> = {}): LocalMapFeatureEntity => ({
  id: "parking-1", family: "parking_area", name: "West Parking", isEditable: true,
  geometryType: "polygon", coordinates: [[0, 0], [0, 1], [1, 0]], status: "active", ...overrides,
});
const link: FeatureLinkEntity = {
  id: "link-1", featureId: "parking-1", targetDomain: "Locations", targetEntityId: "building-1",
  linkType: "building_footprint",
};

describe("LocalMapFeatureWorkflow", () => {
  it("validates create geometry before changing history", () => {
    const workingSession = new WorkingSessionManager();
    const workflow = createLocalMapFeatureWorkflow({ workingSession });
    const result = workflow.finalize({ kind: "create", family: "parking_area", name: "Lot", coordinates: [[0, 0]] });
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(workingSession.getPastOperations()).toHaveLength(0);
  });

  it("creates a normalized feature and completes its Tool Draft", () => {
    const workingSession = new WorkingSessionManager();
    workingSession.startDraft({ toolType: "local_feature", label: "Parking", provisionalGeometry: {} });
    const workflow = createLocalMapFeatureWorkflow({ workingSession });
    const result = workflow.finalize({
      kind: "create", family: "parking_area", name: " West Lot ", coordinates: [[0, 0], [0, 1], [1, 0]],
    });
    expect(result).toMatchObject({ ok: true, feature: { name: "West Lot", surface: "unknown", access: "unknown" }, operation: { type: "create_entity" } });
    expect(workingSession.getActiveDraft()).toBeNull();
  });

  it("updates curated properties without replacing provenance", () => {
    const workingSession = new WorkingSessionManager();
    const workflow = createLocalMapFeatureWorkflow({ workingSession });
    const before = feature({ provenance: { osmId: "way/1", rawTags: { amenity: "parking" } } });
    const result = workflow.finalize({
      kind: "update",
      before,
      after: { ...before, name: "West Visitor Lot", surface: "invalid", coordinates: [[9, 9]] },
    });
    expect(result).toMatchObject({
      ok: true,
      feature: { name: "West Visitor Lot", surface: "unknown", provenance: before.provenance, coordinates: before.coordinates },
      operation: { type: "update_properties" },
    });
  });

  it("retires and unlinks a linked feature as one operation", () => {
    const workingSession = new WorkingSessionManager();
    const workflow = createLocalMapFeatureWorkflow({ workingSession });
    const result = workflow.finalize({ kind: "retire", feature: feature({ linkedBuildingId: "building-1" }), link });
    expect(result).toMatchObject({ ok: true, feature: { status: "retired", linkedBuildingId: null }, operation: { type: "compound_batch" } });
    expect(result.ok && result.operation.nestedOperations?.map((item) => item.type)).toEqual(["retire_entity", "unlink_feature"]);
  });

  it("restores and relinks a linked feature as one operation", () => {
    const workingSession = new WorkingSessionManager();
    const workflow = createLocalMapFeatureWorkflow({ workingSession });
    const result = workflow.finalize({ kind: "restore", feature: feature({ status: "retired", linkedBuildingId: null }), link });
    expect(result).toMatchObject({ ok: true, feature: { status: "active", linkedBuildingId: "building-1" }, operation: { type: "compound_batch" } });
  });
});
