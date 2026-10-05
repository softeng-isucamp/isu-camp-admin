import type { Building, Location, RecordStatus } from "../../../types";
import type { WorkingOperation } from "../types";
import {
  geometryOnCampus,
  pointInPolygon,
  type MapPoint,
} from "../campusBoundary";
import {
  polygonIsNonDegenerate,
  polygonSelfIntersects,
} from "../mapEditing";

export interface BuildingIdentityInput {
  name: string;
  code: string;
  type?: "Building" | "Facility";
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

export function findFirstOverlappingBuilding(
  points: MapPoint[],
  candidates: readonly Building[],
  excludeBuildingId?: string | null,
): Building | null {
  if (points.length < 3) return null;

  for (const building of candidates) {
    if (excludeBuildingId && building.id === excludeBuildingId) continue;
    if (!building.points || building.points.length < 3) continue;

    if (polygonsOverlap(points, building.points)) {
      return building;
    }
  }

  return null;
}

export function findBuildingFootprintOverlaps(
  buildings: readonly Building[],
  filter?: (bldA: Building, bldB: Building) => boolean,
): Array<{ bldA: Building; bldB: Building }> {
  const overlaps: Array<{ bldA: Building; bldB: Building }> = [];

  for (let i = 0; i < buildings.length; i++) {
    const bldA = buildings[i];
    if (!bldA.points || bldA.points.length < 3) continue;
    for (let j = i + 1; j < buildings.length; j++) {
      const bldB = buildings[j];
      if (!bldB.points || bldB.points.length < 3) continue;
      if (filter && !filter(bldA, bldB)) continue;
      if (polygonsOverlap(bldA.points, bldB.points)) {
        overlaps.push({ bldA, bldB });
      }
    }
  }

  return overlaps;
}

export function detectBuildingFootprintOverlap(
  points: MapPoint[],
  existingBuildings: readonly Building[],
  excludeBuildingId?: string | null,
): BuildingOverlapWarning | null {
  const overlapping = findFirstOverlappingBuilding(points, existingBuildings, excludeBuildingId);
  if (!overlapping) return null;

  return {
    overlappingBuildingId: overlapping.id,
    message: `Advisory: Footprint overlaps with ${overlapping.name}. Please review alignment.`,
    advisory: true,
  };
}

export function validateBuildingIdentityDetails(
  input: BuildingIdentityInput,
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
  if (!String(input.function ?? "").trim()) {
    issues.push({ field: "function", message: "Building description is required." });
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

/** The Working Session record of a new Building saved together with its footprint polygon. */
export function buildCreateBuildingOperation(
  input: BuildingIdentityInput,
  footprintPoints: MapPoint[],
  buildingId: string,
): WorkingOperation {
  // The Building Campus Location record stores NO copied outdoor coordinate.
  // Its spatial anchor is derived from the footprint polygon.
  const buildingLocationRecord: Location = {
    id: buildingId,
    name: input.name.trim(),
    code: input.code.trim(),
    type: input.type ?? "Building",
    parentId: null,
    status: input.status ?? "Active",
    lat: null,
    lng: null,
    positioned: false,
    spatialRole: "building_footprint_owner",
    function: input.function?.trim() || undefined,
    keywords: input.keywords?.trim() || undefined,
    polygonCoordinates: [...footprintPoints],
  };

  return {
    id: `create-${buildingId}`,
    type: "create_entity",
    domain: "Locations",
    entityId: buildingId,
    before: null,
    after: buildingLocationRecord as unknown as Record<string, unknown>,
    description: `Create ${buildingLocationRecord.name} with footprint`,
  };
}

/** The Working Session record of a Building's polygon changing (a reshape of its existing footprint). */
export function buildBuildingFootprintOperation(
  building: Building,
  footprintPoints: MapPoint[],
): WorkingOperation {
  return {
    id: `footprint-${building.id}-${Date.now()}`,
    type: "update_geometry",
    domain: "Locations",
    entityId: building.id,
    before: { points: [...(building.points ?? [])] },
    after: { points: [...footprintPoints] },
    description: `Reshape footprint for ${building.name}`,
  };
}
