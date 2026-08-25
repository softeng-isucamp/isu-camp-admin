import { describe, expect, it } from "vitest";
import type { Location, LocationDraft, LocationType } from "../types";
import { generatedMapFixture } from "../services/generatedMapFixture";
import { locations as curatedLocations } from "../services/mockData";
import { locationPolicy } from "./locationPolicy";

const draft = (overrides: Partial<LocationDraft> = {}): LocationDraft => ({
  name: "Computer Laboratory",
  code: "LAB-1",
  type: "Laboratory",
  parentId: null,
  status: "Active",
  lat: null,
  lng: null,
  positioned: false,
  ...overrides,
});

const building: Location = {
  id: "building-1",
  name: "Science Building",
  code: "SCI",
  type: "Building",
  parentId: null,
  status: "Active",
  lat: 16.72,
  lng: 121.69,
  positioned: true,
};

const facility: Location = {
  ...building,
  id: "facility-1",
  name: "Outdoor Pavilion",
  code: "PAV",
  type: "Facility",
};

describe("Location policy", () => {
  it.each([
    ["Building", "outdoor"],
    ["Facility", "outdoor"],
    ["Floor", "floor"],
    ["Room", "indoor"],
    ["Office", "indoor"],
    ["Laboratory", "indoor"],
    ["Restroom", "indoor"],
  ] satisfies Array<[LocationType, "outdoor" | "floor" | "indoor"]>)(
    "classifies %s Locations as %s",
    (type, kind) => {
      expect(locationPolicy.classify(type)).toEqual({
        kind,
        requiresBuildingParent: kind !== "outdoor",
        allowsOutdoorPosition: kind === "outdoor",
      });
    },
  );

  it("normalizes an indoor child from its authoritative Building parent", () => {
    expect(locationPolicy.normalize(draft({
      parentId: building.id,
      building: "Stale Building Name",
      floor: "2nd Floor",
      lat: 16.721,
      lng: 121.691,
      positioned: true,
    }), [building])).toEqual(draft({
      parentId: building.id,
      building: building.name,
      floor: "2nd Floor",
    }));
  });

  it("normalizes an outdoor Location from its coordinate pair", () => {
    expect(locationPolicy.normalize(draft({
      type: "Facility",
      parentId: building.id,
      building: building.name,
      floor: "Ground Floor",
      lat: 16.721,
      lng: 121.691,
      positioned: false,
    }), [building])).toEqual(draft({
      type: "Facility",
      lat: 16.721,
      lng: 121.691,
      positioned: true,
    }));
  });

  it("distinguishes record validity from map readiness", () => {
    const unpositionedFacility = draft({ type: "Facility" });

    expect(locationPolicy.evaluate(unpositionedFacility, {
      context: "record",
      directory: [],
    })).toEqual({ valid: true, issues: [] });

    expect(locationPolicy.evaluate(unpositionedFacility, {
      context: "map-readiness",
      directory: [],
    })).toEqual({
      valid: false,
      issues: [{
        code: "coordinates_required",
        field: "lat",
        message: "Outdoor Locations require latitude and longitude for map readiness.",
      }],
    });
  });

  it.each([
    [draft({ type: "Facility", lat: 16.72 }), [["coordinate_pair_required", "lng"]]],
    [draft({ type: "Facility", lat: 91, lng: 181, positioned: true }), [
      ["latitude_out_of_range", "lat"],
      ["longitude_out_of_range", "lng"],
      ["placement_mismatch", "positioned"],
    ]],
    [draft({ type: "Facility", lat: 16.72, lng: 121.69 }), [["placement_mismatch", "positioned"]]],
  ] satisfies Array<[LocationDraft, Array<[string, keyof LocationDraft]>]>)(
    "reports coordinate and placement issues for outdoor Locations",
    (location, expectedIssues) => {
      const result = locationPolicy.evaluate(location, {
        context: "record",
        directory: [],
      });

      expect(result.issues.map(({ code, field }) => [code, field])).toEqual(expectedIssues);
      expect(result.valid).toBe(false);
    },
  );

  it.each([
    [draft(), [], "building_parent_required"],
    [draft({ parentId: "missing" }), [building], "building_parent_not_found"],
    [draft({ parentId: facility.id }), [building, facility], "building_parent_wrong_type"],
  ] satisfies Array<[LocationDraft, Location[], string]>)(
    "requires a real Building parent for Building children",
    (location, directory, expectedCode) => {
      const result = locationPolicy.evaluate(location, {
        context: "record",
        directory,
      });

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual([
        expect.objectContaining({ code: expectedCode, field: "parentId" }),
      ]);
    },
  );

  it.each([
    "Floor",
    "Room",
    "Office",
    "Laboratory",
    "Restroom",
  ] satisfies LocationType[])(
    "keeps %s Locations unpositioned under a Building",
    (type) => {
      const result = locationPolicy.evaluate(draft({
        type,
        parentId: building.id,
        building: building.name,
        lat: 16.72,
        lng: 121.69,
        positioned: true,
      }), {
        context: "record",
        directory: [building],
      });

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual([
        expect.objectContaining({ code: "outdoor_position_forbidden", field: "lat" }),
      ]);
    },
  );

  it("requires derived Building metadata to match the authoritative parent", () => {
    const result = locationPolicy.evaluate(draft({
      parentId: building.id,
      building: "Stale Building Name",
    }), {
      context: "record",
      directory: [building],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "building_name_mismatch", field: "building" }),
    ]);
  });

  it("rejects hierarchy metadata on outdoor Locations", () => {
    const result = locationPolicy.evaluate(draft({
      type: "Facility",
      parentId: building.id,
      building: building.name,
      floor: "Ground Floor",
      lat: 16.72,
      lng: 121.69,
      positioned: true,
    }), {
      context: "record",
      directory: [building],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "outdoor_hierarchy_forbidden", field: "parentId" }),
    ]);
  });

  it.each(([
    "Building",
    "Facility",
    "Floor",
    "Room",
    "Office",
    "Laboratory",
    "Restroom",
  ] satisfies LocationType[]).flatMap((type) => [
    [type, "record" as const],
    [type, "map-readiness" as const],
  ]))(
    "accepts a canonical %s Location in %s context",
    (type, context) => {
      const isOutdoor = type === "Building" || type === "Facility";
      const location = draft(isOutdoor ? {
        type,
        lat: 16.72,
        lng: 121.69,
        positioned: true,
      } : {
        type,
        parentId: building.id,
        building: building.name,
        floor: type === "Floor" ? undefined : "2nd Floor",
      });

      expect(locationPolicy.evaluate(location, {
        context,
        directory: [building],
      })).toEqual({ valid: true, issues: [] });
    },
  );

  it("normalizes a Floor as an unpositioned Building child", () => {
    expect(locationPolicy.normalize(draft({
      type: "Floor",
      parentId: building.id,
      building: "Stale Building Name",
      floor: "2nd Floor",
      lat: 16.72,
      lng: 121.69,
      positioned: true,
    }), [building])).toEqual(draft({
      type: "Floor",
      parentId: building.id,
      building: building.name,
    }));
  });

  it("accepts the existing curated and generated Location inventories", () => {
    const inventories = [curatedLocations, generatedMapFixture.locations];

    for (const inventory of inventories) {
      const invalid = inventory.flatMap((location) => {
        const result = locationPolicy.evaluate(location, {
          context: "record",
          directory: inventory,
        });
        return result.valid ? [] : [{ id: location.id, issues: result.issues }];
      });

      expect(invalid).toEqual([]);
    }
  });
});
