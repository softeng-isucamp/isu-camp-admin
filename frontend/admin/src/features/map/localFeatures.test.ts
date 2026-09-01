import { describe, expect, it } from "vitest";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../services/mapEditorApiClient";
import {
  EDITABLE_LOCAL_FEATURE_FAMILIES,
  buildRetireLocalFeatureOperation,
  buildRestoreLocalFeatureOperation,
  getLocalFeaturePathOptions,
  normalizeCuratedLocalFeatureProperties,
} from "./localFeatures";

const footprint: LocalMapFeatureEntity = {
  id: "feature-engineering",
  family: "building_footprint",
  name: "Engineering Footprint",
  isEditable: true,
  geometryType: "polygon",
  coordinates: [[16.72, 121.689], [16.721, 121.689], [16.721, 121.69]],
  status: "active",
  linkedBuildingId: "building-engineering",
};

const footprintLink: FeatureLinkEntity = {
  id: "link-engineering",
  featureId: footprint.id,
  targetDomain: "Locations",
  targetEntityId: "building-engineering",
  linkType: "building_footprint",
};

describe("local feature cartography", () => {
  it("defines a distinct creation option and rendering treatment for all five editable families", () => {
    expect(EDITABLE_LOCAL_FEATURE_FAMILIES.map((family) => family.id)).toEqual([
      "building_footprint",
      "parking_area",
      "cartographic_walkway",
      "vehicle_path",
      "campus_boundary",
    ]);

    const colors = EDITABLE_LOCAL_FEATURE_FAMILIES.map((family) =>
      getLocalFeaturePathOptions({ ...footprint, family: family.id }, false).color,
    );
    expect(new Set(colors).size).toBe(5);
  });

  it("retires and unlinks a linked Building Footprint as one operation without touching the Building record", () => {
    const operation = buildRetireLocalFeatureOperation(footprint, footprintLink);

    expect(operation.type).toBe("compound_batch");
    expect(operation.nestedOperations?.map((nested) => nested.type)).toEqual([
      "retire_entity",
      "unlink_feature",
    ]);
    expect(operation.nestedOperations?.some((nested) => nested.domain === "Locations")).toBe(false);
  });

  it("restores and relinks a retired Building Footprint as one operation", () => {
    const retired = { ...footprint, status: "retired" as const, linkedBuildingId: null };
    const operation = buildRestoreLocalFeatureOperation(retired, footprintLink);

    expect(operation.type).toBe("compound_batch");
    expect(operation.nestedOperations?.map((nested) => nested.type)).toEqual([
      "restore_entity",
      "link_feature",
    ]);
  });

  it("renders retired features with a muted dashed treatment", () => {
    const options = getLocalFeaturePathOptions({ ...footprint, status: "retired" }, false);
    expect(options.dashArray).toBe("7 6");
    expect(options.opacity).toBeLessThan(1);
    expect(options.fillOpacity).toBeLessThan(0.2);
  });

  it("rejects arbitrary local tag strings at the curated property boundary", () => {
    const normalized = normalizeCuratedLocalFeatureProperties({
      ...footprint,
      surface: "lava",
      access: "friends_only",
      direction: "sideways",
    });

    expect(normalized.surface).toBe("unknown");
    expect(normalized.access).toBe("unknown");
    expect(normalized.direction).toBe("both");
  });
});
