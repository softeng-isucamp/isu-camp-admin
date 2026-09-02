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
  validateBuildingIdentityDetails,
  type BuildingIdentityInput,
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
    id: "bld-eng",
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
    id: "loc-gate",
    name: "Main Gate",
    code: "GATE-01",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: 16.720,
    lng: 121.690,
    positioned: true,
  },
];

const existingBuildings: Building[] = [
  {
    id: "bld-eng",
    name: "Engineering Hall",
    code: "ENG-01",
    points: validPoints,
    status: "Active",
  },
];

describe("validateBuildingFootprintGeometry", () => {
  it("accepts a non-degenerate, non-self-intersecting polygon within campus bounds", () => {
    expect(validateBuildingFootprintGeometry(validPoints, campusBoundary)).toEqual([]);
  });

  it("rejects fewer than 3 vertices", () => {
    const issues = validateBuildingFootprintGeometry([[16.720, 121.689], [16.721, 121.690]], campusBoundary);
    expect(issues).toContainEqual({
      field: "geometry",
      message: "Building footprint requires at least 3 distinct non-collinear vertices.",
    });
  });

  it("rejects collinear vertices", () => {
    const collinear: MapPoint[] = [
      [16.720, 121.689],
      [16.721, 121.689],
      [16.722, 121.689],
    ];
    const issues = validateBuildingFootprintGeometry(collinear, campusBoundary);
    expect(issues).toContainEqual({
      field: "geometry",
      message: "Building footprint requires at least 3 distinct non-collinear vertices.",
    });
  });

  it("rejects self-intersecting hourglass polygon", () => {
    const bowtie: MapPoint[] = [
      [16.720, 121.689],
      [16.722, 121.691],
      [16.722, 121.689],
      [16.720, 121.691],
    ];
    const issues = validateBuildingFootprintGeometry(bowtie, campusBoundary);
    expect(issues).toContainEqual({
      field: "geometry",
      message: "Building footprint contains self-intersecting edges.",
    });
  });

  it("rejects invalid or non-finite coordinates", () => {
    const invalid: MapPoint[] = [
      [16.720, 121.689],
      [NaN, 121.690],
      [16.721, 121.691],
    ];
    const issues = validateBuildingFootprintGeometry(invalid, campusBoundary);
    expect(issues).toContainEqual({
      field: "geometry",
      message: "Building footprint contains invalid or non-finite coordinates.",
    });
  });

  it("rejects coordinates outside campus boundary", () => {
    const outside: MapPoint[] = [
      [16.700, 121.680],
      [16.700, 121.685],
      [16.705, 121.685],
    ];
    const issues = validateBuildingFootprintGeometry(outside, campusBoundary);
    expect(issues).toContainEqual({
      field: "geometry",
      message: "The building footprint must stay inside the ISU Echague campus boundary.",
    });
  });
});

describe("detectBuildingFootprintOverlap", () => {
  it("detects overlap and returns advisory warning rather than blocking", () => {
    // Slightly offset overlapping square
    const overlapping: MapPoint[] = [
      [16.721, 121.690],
      [16.721, 121.692],
      [16.723, 121.692],
      [16.723, 121.690],
    ];
    const warning = detectBuildingFootprintOverlap(overlapping, existingBuildings);
    expect(warning).not.toBeNull();
    expect(warning?.advisory).toBe(true);
    expect(warning?.overlappingBuildingId).toBe("bld-eng");
    expect(warning?.message).toMatch(/overlaps with Engineering Hall/);
  });

  it("returns null when footprints are fully disjoint", () => {
    const disjoint: MapPoint[] = [
      [16.723, 121.692],
      [16.723, 121.693],
      [16.724, 121.693],
      [16.724, 121.692],
    ];
    expect(detectBuildingFootprintOverlap(disjoint, existingBuildings)).toBeNull();
  });

  it("excludes current building when checking overlap", () => {
    const sameShape = [...validPoints];
    expect(detectBuildingFootprintOverlap(sameShape, existingBuildings, "bld-eng")).toBeNull();
  });
});

describe("validateBuildingIdentityDetails", () => {
  const validIdentity: BuildingIdentityInput = {
    name: "Science Complex",
    code: "SCI-01",
    function: "Academic and Research Laboratories",
    keywords: "science, biology, chem",
    status: "Active",
  };

  it("accepts complete identity details with unique code", () => {
    expect(validateBuildingIdentityDetails(validIdentity, existingLocations)).toEqual([]);
  });

  it("rejects empty name and empty code", () => {
    const issues = validateBuildingIdentityDetails({ ...validIdentity, name: "  ", code: "" }, existingLocations);
    expect(issues).toContainEqual({ field: "name", message: "Building name is required." });
    expect(issues).toContainEqual({ field: "code", message: "Building code is required." });
  });

  it("rejects duplicate code with case-insensitive comparison", () => {
    const issues = validateBuildingIdentityDetails({ ...validIdentity, code: " eng-01 " }, existingLocations);
    expect(issues).toContainEqual({ field: "code", message: "Building code must be unique." });
  });
});

describe("getBuildingAttachmentEligibility", () => {
  const links: FeatureLinkEntity[] = [
    {
      id: "link-1",
      featureId: "feat-poly-bld-eng",
      targetDomain: "Locations",
      targetEntityId: "bld-eng",
      linkType: "building_footprint",
    },
  ];

  it("rejects inactive building", () => {
    const bld: Building = { id: "bld-inactive", name: "Old Hall", code: "OLD", points: [], status: "Inactive" };
    expect(getBuildingAttachmentEligibility(bld, links)).toEqual({
      eligible: false,
      reason: "Building is inactive",
    });
  });

  it("rejects building already linked via FeatureLinkEntity", () => {
    const bld: Building = { id: "bld-eng", name: "Engineering", code: "ENG", points: [], status: "Active" };
    expect(getBuildingAttachmentEligibility(bld, links)).toEqual({
      eligible: false,
      reason: "Already linked to footprint feat-poly-bld-eng",
    });
  });

  it("rejects building with existing points", () => {
    const bld: Building = { id: "bld-has-points", name: "Gym", code: "GYM", points: validPoints, status: "Active" };
    expect(getBuildingAttachmentEligibility(bld, [])).toEqual({
      eligible: false,
      reason: "Building already has a footprint",
    });
  });

  it("approves active building without active link or footprint", () => {
    const bld: Building = { id: "bld-open", name: "Student Center", code: "STU", points: [], status: "Active" };
    expect(getBuildingAttachmentEligibility(bld, links)).toEqual({
      eligible: true,
      reason: null,
    });
  });
});

describe("buildCreateBuildingCompoundOperation", () => {
  it("builds ordered compound operation with Campus Location -> Footprint -> Link", () => {
    const input: BuildingIdentityInput = {
      name: "New Laboratory Building",
      code: "LAB-NEW",
      function: "Research",
      keywords: "lab, research",
    };
    const batch = buildCreateBuildingCompoundOperation(input, validPoints, "bld-test-123");
    expect(batch.type).toBe("compound_batch");
    expect(batch.nestedOperations).toHaveLength(3);

    const [createLoc, createFeat, createLink] = batch.nestedOperations!;

    // 1. Campus Location Building (stores NO copied outdoor coordinate)
    expect(createLoc.type).toBe("create_entity");
    expect(createLoc.domain).toBe("Locations");
    expect(createLoc.after).toMatchObject({
      id: "bld-test-123",
      name: "New Laboratory Building",
      code: "LAB-NEW",
      type: "Building",
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    });

    // 2. Building Footprint
    expect(createFeat.type).toBe("create_entity");
    expect(createFeat.domain).toBe("Local Map Data");
    expect(createFeat.after).toMatchObject({
      family: "building_footprint",
      geometryType: "polygon",
      coordinates: validPoints,
      status: "active",
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
});

describe("buildAttachBuildingCompoundOperation", () => {
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
      status: "active",
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
