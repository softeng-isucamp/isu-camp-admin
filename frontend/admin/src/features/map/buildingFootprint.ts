import type { Building, Location, RecordStatus } from "../../types";
import type { FeatureLinkEntity, LocalMapFeatureEntity, WorkingOperation } from "../../services/mapEditorApiClient";
import {
  geometryOnCampus,
  pointInPolygon,
  type MapPoint,
} from "./campusBoundary";
import {
  polygonFeatureAnchor,
  polygonIsNonDegenerate,
  polygonSelfIntersects,
} from "./mapEditing";

export interface BuildingOwnerInput {
  name: string;
  code: string;
  function?: string;
  keywords?: string;
  status?: RecordStatus;
}

export type BuildingValidationField = "geometry" | "name" | "code" | "function" | "status";

export interface BuildingValidationIssue {
  field: BuildingValidationField;
  message: string;
}

export interface BuildingOverlapWarning {
  overlappingBuildingId: string;
  message: string;
  advisory: true;
}

/** Check if two line segments (p1-p2 and p3-p4) intersect. */
function segmentsIntersect(
  p1: MapPoint,
  p2: MapPoint,
  p3: MapPoint,
  p4: MapPoint,
): boolean {
  const orientation = (a: MapPoint, b: MapPoint, c: MapPoint) => {
    const val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return Math.abs(val) < Number.EPSILON ? 0 : val > 0 ? 1 : 2;
  };
  const onSegment = (a: MapPoint, b: MapPoint, c: MapPoint) =>
    Math.min(a[0], c[0]) <= b[0] && b[0] <= Math.max(a[0], c[0])
    && Math.min(a[1], c[1]) <= b[1] && b[1] <= Math.max(a[1], c[1]);

  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

/** Returns true if two simple polygons overlap in 2D space. */
export function polygonsOverlap(polyA: MapPoint[], polyB: MapPoint[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;

  // 1. Check if any edge of A intersects any edge of B
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  // 2. Check if any vertex of A is strictly inside B
  for (const pt of polyA) {
    if (pointInPolygon(pt, polyB)) return true;
  }

  // 3. Check if any vertex of B is strictly inside A
  for (const pt of polyB) {
    if (pointInPolygon(pt, polyA)) return true;
  }

  return false;
}

export function validateBuildingFootprintGeometry(
  points: MapPoint[],
  campusBoundary?: MapPoint[],
): BuildingValidationIssue[] {
  const issues: BuildingValidationIssue[] = [];

  const hasInvalidCoords = points.some(
    ([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180,
  );
  if (hasInvalidCoords) {
    issues.push({ field: "geometry", message: "Building footprint contains invalid or non-finite coordinates." });
    return issues;
  }

  if (points.length < 3 || !polygonIsNonDegenerate(points)) {
    issues.push({ field: "geometry", message: "Building footprint requires at least 3 distinct non-collinear vertices." });
  }

  if (polygonSelfIntersects(points)) {
    issues.push({ field: "geometry", message: "Building footprint contains self-intersecting edges." });
  }

  if (campusBoundary && !geometryOnCampus(points, campusBoundary)) {
    issues.push({ field: "geometry", message: "The building footprint must stay inside the ISU Echague campus boundary." });
  }

  return issues;
}

export function detectBuildingFootprintOverlap(
  points: MapPoint[],
  existingBuildings: readonly Building[],
  excludeBuildingId?: string | null,
): BuildingOverlapWarning | null {
  if (points.length < 3) return null;

  for (const building of existingBuildings) {
    if (excludeBuildingId && building.id === excludeBuildingId) continue;
    if (!building.points || building.points.length < 3) continue;

    if (polygonsOverlap(points, building.points)) {
      return {
        overlappingBuildingId: building.id,
        message: `Advisory: Footprint overlaps with ${building.name}. Please review alignment.`,
        advisory: true,
      };
    }
  }

  return null;
}

export function validateBuildingOwnerDetails(
  input: BuildingOwnerInput,
  existingLocations: readonly Location[],
  editingBuildingId?: string | null,
): BuildingValidationIssue[] {
  const issues: BuildingValidationIssue[] = [];

  if (!input.name.trim()) {
    issues.push({ field: "name", message: "Building name is required." });
  }
  if (!input.code.trim()) {
    issues.push({ field: "code", message: "Building code is required." });
  }

  const trimmedCode = input.code.trim().toLowerCase();
  if (trimmedCode) {
    const duplicate = existingLocations.some(
      (loc) => loc.id !== editingBuildingId && loc.code.trim().toLowerCase() === trimmedCode,
    );
    if (duplicate) {
      issues.push({ field: "code", message: "Building code must be unique." });
    }
  }

  return issues;
}

export function getBuildingAttachmentEligibility(
  building: Building,
  featureLinks: readonly FeatureLinkEntity[],
): { eligible: true; reason: null } | { eligible: false; reason: string } {
  if (building.status === "Inactive") {
    return { eligible: false, reason: "Building is inactive" };
  }

  const activeLink = featureLinks.find((link) => link.targetEntityId === building.id);
  if (activeLink) {
    return { eligible: false, reason: `Already linked to footprint ${activeLink.featureId}` };
  }

  if (building.points && building.points.length >= 3) {
    return { eligible: false, reason: "Building already has a footprint" };
  }

  return { eligible: true, reason: null };
}

export function buildCreateBuildingCompoundOperation(
  input: BuildingOwnerInput,
  footprintPoints: MapPoint[],
  overrideId?: string,
): WorkingOperation {
  const buildingId = overrideId ?? `building-${Date.now()}`;
  const featureId = `feat-poly-${buildingId}`;
  const linkId = `link-${featureId}-${buildingId}`;

  // The Building Campus Location record stores NO copied outdoor coordinate.
  // Its spatial anchor is derived from the authoritative footprint geometry.
  const buildingLocationRecord: Location = {
    id: buildingId,
    name: input.name.trim(),
    code: input.code.trim(),
    type: "Building",
    parentId: null,
    status: input.status ?? "Active",
    lat: null,
    lng: null,
    positioned: false,
    function: input.function?.trim() || undefined,
    keywords: input.keywords?.trim() || undefined,
  };

  const footprintFeature: LocalMapFeatureEntity = {
    id: featureId,
    family: "building_footprint",
    name: `${input.name.trim()} footprint`,
    isEditable: true,
    status: "active",
    geometryType: "polygon",
    coordinates: [...footprintPoints],
    linkedBuildingId: buildingId,
  };

  const featureLink: FeatureLinkEntity = {
    id: linkId,
    featureId,
    targetDomain: "Locations",
    targetEntityId: buildingId,
    linkType: "building_footprint",
  };

  // 1. Campus Location Building -> 2. Building Footprint -> 3. Feature Link
  const nestedOperations: WorkingOperation[] = [
    {
      id: `create-${buildingId}`,
      type: "create_entity",
      domain: "Locations",
      entityId: buildingId,
      before: null,
      after: buildingLocationRecord as unknown as Record<string, unknown>,
      description: `Create Campus Location ${buildingLocationRecord.name}`,
    },
    {
      id: `create-${featureId}`,
      type: "create_entity",
      domain: "Local Map Data",
      entityId: featureId,
      before: null,
      after: footprintFeature as unknown as Record<string, unknown>,
      description: `Create ${footprintFeature.name}`,
    },
    {
      id: `create-${linkId}`,
      type: "link_feature",
      domain: "Local Map Data",
      entityId: linkId,
      before: null,
      after: featureLink as unknown as Record<string, unknown>,
      description: `Link footprint to ${buildingLocationRecord.name}`,
    },
  ];

  return {
    id: `compound-create-${buildingId}`,
    type: "compound_batch",
    domain: "Local Map Data",
    entityId: featureId,
    description: `Create ${input.name.trim()} with footprint`,
    before: null,
    after: null,
    nestedOperations,
  };
}

export function buildAttachBuildingCompoundOperation(
  targetBuilding: Building,
  footprintPoints: MapPoint[],
): WorkingOperation {
  const featureId = `feat-poly-${targetBuilding.id}`;
  const linkId = `link-${featureId}-${targetBuilding.id}`;

  const footprintFeature: LocalMapFeatureEntity = {
    id: featureId,
    family: "building_footprint",
    name: `${targetBuilding.name.trim()} footprint`,
    isEditable: true,
    status: "active",
    geometryType: "polygon",
    coordinates: [...footprintPoints],
    linkedBuildingId: targetBuilding.id,
  };

  const featureLink: FeatureLinkEntity = {
    id: linkId,
    featureId,
    targetDomain: "Locations",
    targetEntityId: targetBuilding.id,
    linkType: "building_footprint",
  };

  // Atomic compound containing ONLY footprint and link; NEVER duplicates Campus Location
  const nestedOperations: WorkingOperation[] = [
    {
      id: `create-${featureId}`,
      type: "create_entity",
      domain: "Local Map Data",
      entityId: featureId,
      before: null,
      after: footprintFeature as unknown as Record<string, unknown>,
      description: `Create ${footprintFeature.name}`,
    },
    {
      id: `create-${linkId}`,
      type: "link_feature",
      domain: "Local Map Data",
      entityId: linkId,
      before: null,
      after: featureLink as unknown as Record<string, unknown>,
      description: `Link footprint to ${targetBuilding.name}`,
    },
  ];

  return {
    id: `compound-attach-${targetBuilding.id}`,
    type: "compound_batch",
    domain: "Local Map Data",
    entityId: featureId,
    description: `Attach footprint to ${targetBuilding.name}`,
    before: null,
    after: null,
    nestedOperations,
  };
}
