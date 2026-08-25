import type { Location, LocationDraft, LocationType } from "../types";

export type LocationKind = "outdoor" | "floor" | "indoor";

export interface LocationClassification {
  kind: LocationKind;
  requiresBuildingParent: boolean;
  allowsOutdoorPosition: boolean;
}

export type LocationPolicyContext = "record" | "map-readiness";

export type LocationPolicyIssueCode =
  | "building_parent_required"
  | "building_parent_not_found"
  | "building_parent_wrong_type"
  | "building_name_mismatch"
  | "outdoor_hierarchy_forbidden"
  | "coordinate_pair_required"
  | "latitude_out_of_range"
  | "longitude_out_of_range"
  | "coordinates_required"
  | "placement_mismatch"
  | "outdoor_position_forbidden";

export interface LocationPolicyIssue {
  code: LocationPolicyIssueCode;
  field: keyof LocationDraft;
  message: string;
}

export interface LocationPolicyEvaluation {
  valid: boolean;
  issues: LocationPolicyIssue[];
}

export interface LocationPolicyOptions {
  context: LocationPolicyContext;
  directory: readonly Location[];
}

export interface LocationNormalizationOptions {
  directory: readonly Location[];
  previous: LocationDraft;
}

export interface LocationPolicy {
  classify(type: LocationType): LocationClassification;
  normalize(draft: LocationDraft, options: LocationNormalizationOptions): LocationDraft;
  evaluate(draft: LocationDraft, options: LocationPolicyOptions): LocationPolicyEvaluation;
}

const classify = (type: LocationType): LocationClassification => {
  const kind: LocationKind = type === "Building" || type === "Facility"
    ? "outdoor"
    : type === "Floor"
      ? "floor"
      : "indoor";

  return {
    kind,
    requiresBuildingParent: kind !== "outdoor",
    allowsOutdoorPosition: kind === "outdoor",
  };
};

const analyzeCoordinates = (draft: LocationDraft) => {
  const hasLat = draft.lat !== null;
  const hasLng = draft.lng !== null;
  const latitudeValid = hasLat
    && Number.isFinite(draft.lat)
    && draft.lat! >= -90
    && draft.lat! <= 90;
  const longitudeValid = hasLng
    && Number.isFinite(draft.lng)
    && draft.lng! >= -180
    && draft.lng! <= 180;

  return {
    hasLat,
    hasLng,
    latitudeValid,
    longitudeValid,
    valid: latitudeValid && longitudeValid,
  };
};

const normalize = (
  draft: LocationDraft,
  options: LocationNormalizationOptions,
): LocationDraft => {
  const classification = classify(draft.type);
  const coordinates = analyzeCoordinates(draft);

  if (classification.kind === "outdoor") {
    return {
      ...draft,
      parentId: null,
      building: undefined,
      floor: undefined,
      positioned: coordinates.valid,
    };
  }

  const parent = options.directory.find(
    (location) => location.id === draft.parentId && location.type === "Building",
  );
  const parentChanged = options.previous.parentId !== draft.parentId;

  return {
    ...draft,
    building: parent?.name,
    floor: classification.kind === "floor" || parentChanged ? undefined : draft.floor,
    lat: null,
    lng: null,
    positioned: false,
  };
};

const evaluate = (
  draft: LocationDraft,
  options: LocationPolicyOptions,
): LocationPolicyEvaluation => {
  const issues: LocationPolicyIssue[] = [];
  const classification = classify(draft.type);
  const coordinates = analyzeCoordinates(draft);

  if (classification.requiresBuildingParent) {
    const parent = options.directory.find((location) => location.id === draft.parentId);

    if (!draft.parentId) {
      issues.push({
        code: "building_parent_required",
        field: "parentId",
        message: `${draft.type} Locations require a parent Building.`,
      });
    } else if (!parent) {
      issues.push({
        code: "building_parent_not_found",
        field: "parentId",
        message: "The selected parent Location does not exist.",
      });
    } else if (parent.type !== "Building") {
      issues.push({
        code: "building_parent_wrong_type",
        field: "parentId",
        message: "The selected parent Location must be a Building.",
      });
    } else if (draft.building !== parent.name) {
      issues.push({
        code: "building_name_mismatch",
        field: "building",
        message: "Building name must match the selected parent Building.",
      });
    }
  } else if (draft.parentId !== null || draft.building !== undefined || draft.floor !== undefined) {
    issues.push({
      code: "outdoor_hierarchy_forbidden",
      field: "parentId",
      message: `${draft.type} Locations cannot belong to an indoor Building hierarchy.`,
    });
  }

  if (classification.allowsOutdoorPosition) {
    if (coordinates.hasLat !== coordinates.hasLng) {
      issues.push({
        code: "coordinate_pair_required",
        field: coordinates.hasLat ? "lng" : "lat",
        message: "Latitude and longitude must be provided together.",
      });
    }

    if (coordinates.hasLat && !coordinates.latitudeValid) {
      issues.push({
        code: "latitude_out_of_range",
        field: "lat",
        message: "Latitude must be between -90 and 90.",
      });
    }

    if (coordinates.hasLng && !coordinates.longitudeValid) {
      issues.push({
        code: "longitude_out_of_range",
        field: "lng",
        message: "Longitude must be between -180 and 180.",
      });
    }

    if (options.context === "map-readiness" && !coordinates.hasLat && !coordinates.hasLng) {
      issues.push({
        code: "coordinates_required",
        field: "lat",
        message: "Outdoor Locations require latitude and longitude for map readiness.",
      });
    }

    if (draft.positioned !== coordinates.valid) {
      issues.push({
        code: "placement_mismatch",
        field: "positioned",
        message: "Placement state must match valid paired coordinates.",
      });
    }
  } else if (coordinates.hasLat || coordinates.hasLng || draft.positioned) {
    issues.push({
      code: "outdoor_position_forbidden",
      field: "lat",
      message: `${draft.type} Locations must remain unpositioned on the outdoor map.`,
    });
  }

  return { valid: issues.length === 0, issues };
};

export const locationPolicy: LocationPolicy = { classify, normalize, evaluate };
