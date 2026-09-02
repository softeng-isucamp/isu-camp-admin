import { describe, expect, it } from "vitest";
import type { Building, Location } from "../../types";
import type { FeatureLinkEntity } from "../../services/mapEditorApiClient";
import type { MapPoint } from "./campusBoundary";
import {
  buildAttachBuildingCompoundOperation,
  buildCreateBuildingCompoundOperation,
  detectBuildingFootprintOverlap,
  getBuildingAttachmentEligibility,
  validateBuildingFootprintGeometry,
  validateBuildingOwnerDetails,
  type BuildingOwnerInput,
} from "./buildingFootprint";

const campusBoundary: MapPoint[] = [
  [16.719, 121.688],
  [16.719, 121.693],
  [16.724, 121.693],
  [16.724, 121.688],
];

const validPoints: MapPoint[] = [
  [16.720, 121.689],
  [16.720, 121.691],
  [16.722, 121.691],
  [16.722, 121.689],
];

const existingLocations: Location[] = [
  {
    id: "loc-1",
    name: "Engineering Hall",
    code: "ENG-01",
    type: "Building",
    parentId: null,
    status: "Active",
    lat: null,
    lng: null,
    positioned: false,
  },
  {
    id: "loc-2",
    name: "Flagpole",
    code: "FLAG",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: 16.7205,
    lng: 121.6895,
    positioned: true,
  },
];

describe("validateBuildingFootprintGeometry", () => {
  it("accepts a non-degenerate, non-self-intersecting polygon completely inside campus boundary", () => {
    const issues = validateBuildingFootprintGeometry(validPoints, campusBoundary);
    expect(issues).toEqual([]);
  });

  it("rejects degenerate polygons with fewer than 3 points or collinear zero area", () => {
    const fewPoints: MapPoint[] = [[16.720, 121.689], [16.721, 121.690]];
    expect(validateBuildingFootprintGeometry(fewPoints, campusBoundary)).toContainEqual({
      field: "geometry",
      message: "Building footprint requires at least 3 distinct non-collinear vertices.",
    });

    const collinear: MapPoint[] = [
      [16.720, 121.689],
      [16.721, 121.689],
      [16.722, 121.689],
    ];
    expect(validateBuildingFootprintGeometry(collinear, campusBoundary)).toContainEqual({
      field: "geometry",
      message: "Building footprint requires at least 3 distinct non-collinear vertices.",
    });
  });

  it("rejects self-intersecting polygon geometry", () => {
    const hourglass: MapPoint[] = [
      [16.720, 121.689],
      [16.722, 121.691],
      [16.722, 121.689],
      [16.720, 121.691],
    ];
    expect(validateBuildingFootprintGeometry(hourglass, campusBoundary)).toContainEqual({
      field: "geometry",
      message: "Building footprint contains self-intersecting edges.",
    });
  });

  it("rejects geometry containing invalid coordinates or extending outside campus boundary", () => {
    const outside: MapPoint[] = [
      [16.710, 121.680],
      [16.710, 121.690],
      [16.715, 121.690],
    ];
    expect(validateBuildingFootprintGeometry(outside, campusBoundary)).toContainEqual({
      field: "geometry",
      message: "The building footprint must stay inside the ISU Echague campus boundary.",
    });

    const invalidCoords: MapPoint[] = [
      [NaN, 121.689],
      [16.720, 121.691],
      [16.722, 121.691],
    ];
    expect(validateBuildingFootprintGeometry(invalidCoords, campusBoundary)).toContainEqual({
      field: "geometry",
      message: "Building footprint contains invalid or non-finite coordinates.",
    });
  });
});

describe("detectBuildingFootprintOverlap", () => {
  const existingBuildings: Building[] = [
    {
      id: "bld-eng",
      name: "Engineering Hall",
      code: "ENG-01",
      points: [
        [16.720, 121.689],
        [16.720, 121.691],
        [16.722, 121.691],
        [16.722, 121.689],
      ],
    },
  ];

  it("returns null when candidate footprint does not overlap existing buildings", () => {
    const distant: MapPoint[] = [
      [16.7225, 121.6915],
      [16.7225, 121.6925],
      [16.7235, 121.6925],
      [16.7235, 121.6915],
    ];
    expect(detectBuildingFootprintOverlap(distant, existingBuildings)).toBeNull();
  });

  it("detects overlap when candidate polygon intersects an existing building footprint", () => {
    const overlapping: MapPoint[] = [
      [16.721, 121.690],
      [16.721, 121.692],
      [16.723, 121.692],
      [16.723, 121.690],
    ];
    const warning = detectBuildingFootprintOverlap(overlapping, existingBuildings);
    expect(warning).not.toBeNull();
    expect(warning?.overlappingBuildingId).toBe("bld-eng");
    expect(warning?.message).toContain("Engineering Hall");
    expect(warning?.advisory).toBe(true);
  });

  it("excludes the target building itself during attachment or editing", () => {
    const sameShape = [...existingBuildings[0].points];
    expect(detectBuildingFootprintOverlap(sameShape, existingBuildings, "bld-eng")).toBeNull();
  });
});

describe("validateBuildingOwnerDetails", () => {
  const validOwner: BuildingOwnerInput = {
    name: "Science Complex",
    code: "SCI-01",
    function: "Academic and Research Laboratories",
    keywords: "science, biology, chem",
    status: "Active",
  };

  it("accepts complete owner details with unique code", () => {
    expect(validateBuildingOwnerDetails(validOwner, existingLocations)).toEqual([]);
  });

  it("rejects empty name and empty code", () => {
    const issues = validateBuildingOwnerDetails({ ...validOwner, name: "  ", code: "" }, existingLocations);
    expect(issues).toContainEqual({ field: "name", message: "Building name is required." });
    expect(issues).toContainEqual({ field: "code", message: "Building code is required." });
  });

  it("rejects duplicate code with case-insensitive comparison", () => {
    const issues = validateBuildingOwnerDetails({ ...validOwner, code: " eng-01 " }, existingLocations);
    expect(issues).toContainEqual({ field: "code", message: "Building code must be unique." });
  });
});

describe("getBuildingAttachmentEligibility", () => {
  const links: FeatureLinkEntity[] = [
    {
      id: "link-bld-1",
      featureId: "feat-poly-bld-1",
      targetDomain: "Locations",
      targetEntityId: "bld-with-poly",
      linkType: "building_footprint",
    },
  ];

  it("marks active building without footprint as eligible", () => {
    const building: Building = { id: "bld-empty", name: "Empty Hall", code: "EMPTY", points: [], status: "Active" };
    expect(getBuildingAttachmentEligibility(building, links)).toEqual({ eligible: true, reason: null });
  });

  it("marks building with existing feature link as ineligible", () => {
    const building: Building = { id: "bld-with-poly", name: "Linked Hall", code: "LINKED", points: [], status: "Active" };
    expect(getBuildingAttachmentEligibility(building, links)).toEqual({
      eligible: false,
      reason: "Already linked to footprint feat-poly-bld-1",
    });
  });

  it("marks inactive building as ineligible", () => {
    const building: Building = { id: "bld-inactive", name: "Old Hall", code: "OLD", points: [], status: "Inactive" };
    expect(getBuildingAttachmentEligibility(building, links)).toEqual({
      eligible: false,
      reason: "Building is inactive",
    });
  });
});

describe("Compound Operation Builders", () => {
  it("builds ordered compound operation for Create New Building", () => {
    const owner: BuildingOwnerInput = {
      name: "New Research Lab",
      code: "NRL-01",
      function: "Research",
      keywords: "lab, research",
      status: "Active",
    };
    const batch = buildCreateBuildingCompoundOperation(owner, validPoints);
    expect(batch.type).toBe("compound_batch");
    expect(batch.nestedOperations).toHaveLength(3);

    const [createLoc, createFeat, createLink] = batch.nestedOperations!;

    // 1. Campus Location Building
    expect(createLoc.type).toBe("create_entity");
    expect(createLoc.domain).toBe("Locations");
    expect(createLoc.after).toMatchObject({
      name: "New Research Lab",
      code: "NRL-01",
      type: "Building",
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
      function: "Research",
      keywords: "lab, research",
    });

    // 2. Building Footprint
    expect(createFeat.type).toBe("create_entity");
    expect(createFeat.domain).toBe("Local Map Data");
    expect(createFeat.after).toMatchObject({
      family: "building_footprint",
      geometryType: "polygon",
      coordinates: validPoints,
      status: "active",
      linkedBuildingId: createLoc.entityId,
    });

    // 3. Feature Link
    expect(createLink.type).toBe("link_feature");
    expect(createLink.domain).toBe("Local Map Data");
    expect(createLink.after).toMatchObject({
      featureId: createFeat.entityId,
      targetDomain: "Locations",
      targetEntityId: createLoc.entityId,
      linkType: "building_footprint",
    });
  });

  it("builds atomic compound operation for Attach Existing Building without duplicating Location", () => {
    const existing: Building = {
      id: "bld-existing-123",
      name: "Existing Administration",
      code: "ADM",
      points: [],
      status: "Active",
    };
    const batch = buildAttachBuildingCompoundOperation(existing, validPoints);
    expect(batch.type).toBe("compound_batch");
    expect(batch.nestedOperations).toHaveLength(2);

    const [createFeat, createLink] = batch.nestedOperations!;
    expect(createFeat.type).toBe("create_entity");
    expect(createFeat.domain).toBe("Local Map Data");
    expect(createFeat.after).toMatchObject({
      family: "building_footprint",
      geometryType: "polygon",
      coordinates: validPoints,
      linkedBuildingId: "bld-existing-123",
    });

    expect(createLink.type).toBe("link_feature");
    expect(createLink.domain).toBe("Local Map Data");
    expect(createLink.after).toMatchObject({
      featureId: createFeat.entityId,
      targetEntityId: "bld-existing-123",
      linkType: "building_footprint",
    });

    // Verify no Locations operation exists in the batch
    expect(batch.nestedOperations?.some((op) => op.domain === "Locations")).toBe(false);
  });
});
