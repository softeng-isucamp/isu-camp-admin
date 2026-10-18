import { PLACE_CLASSIFICATIONS, SELECTABLE_PLACE_CLASSIFICATIONS } from "../types";
import type { Location, LocationDraft, LocationType, PlaceClassification } from "../types";

export type LocationKind = "outdoor" | "floor" | "indoor";

export const indoorLocationTypes = ["Room", "Office", "Laboratory", "Restroom"] as const;
// "1st Floor" is deliberately absent: it and "Ground Floor" named the same
// storey, so the directory keeps one of them. The backend stores it as floor
// number 1 and renders that as "Ground Floor", which is why nothing here
// needs to change when an older record comes back.
export const standardFloorLevels = [
  "Ground Floor", "2nd Floor", "3rd Floor", "4th Floor", "5th Floor", "Basement",
] as const;

export const isIndoorLocationType = (type: LocationType) =>
  (indoorLocationTypes as readonly string[]).includes(type);

/** Whether a Place with this classification can contain indoor Locations. New classifications add a row. */
const classificationCanContain: Record<PlaceClassification, boolean> = {
  College: true,
  "Campus Services": true,
  Building: true,
  Facility: false,
  Food: false,
  Parking: false,
};

export const canContainLocations = (classification: PlaceClassification): boolean =>
  classificationCanContain[classification] ?? false;

export const isPlace = (location: Pick<Location, "type">): boolean => location.type === "Place";

/** A Place that can be the parent of indoor Locations (today: Buildings). */
export const isLocationContainer = (location: Pick<Location, "type" | "classification">): boolean =>
  location.type === "Place" && canContainLocations(placeClassificationOf(location));

/** Classification of a Place record; Places without one are treated as Buildings. */
export const placeClassificationOf = (location: Pick<Location, "classification">): PlaceClassification =>
  location.classification ?? "Building";

/** What the backend calls a record's type: a Place's classification, otherwise its own type. */
export type BackendLocationType = Exclude<LocationType, "Place"> | PlaceClassification;

export const backendLocationType = (location: Pick<Location, "type" | "classification">): BackendLocationType =>
  location.type === "Place" ? placeClassificationOf(location) : location.type;

/** Sets a type-picker choice ("Building", "Facility", "Room", ...) on a draft: Places carry it as their classification. */
export const withLocationTypeOption = <T extends LocationDraft>(draft: T, option: BackendLocationType): T => {
  const { classification: _classification, ...rest } = draft;
  return isPlaceClassification(option)
    ? { ...rest, type: "Place", classification: option } as T
    : { ...rest, type: option } as T;
};

export const isPlaceClassification = (value: unknown): value is PlaceClassification =>
  (PLACE_CLASSIFICATIONS as readonly unknown[]).includes(value);

/** What a classification picker offers: the selectable set, plus the record's current value when that is not selectable. */
export const placeClassificationOptions = (current?: PlaceClassification): PlaceClassification[] => {
  const selectable: PlaceClassification[] = [...SELECTABLE_PLACE_CLASSIFICATIONS];
  return current && !selectable.includes(current) ? [...selectable, current] : selectable;
};

/** A backend classification string; null, missing, and unknown values read as Building. */
export const classificationFromBackend = (raw: unknown): PlaceClassification =>
  isPlaceClassification(raw) ? raw : "Building";

/**
 * Anything that is not an indoor type or "Floor" is a Place, classified by
 * `classificationFromBackend`. Never throws.
 */
export const placeFieldsFromBackendType = (raw: unknown):
  | { type: Exclude<LocationType, "Place"> }
  | { type: "Place"; classification: PlaceClassification } => {
  if (raw === "Floor" || (indoorLocationTypes as readonly unknown[]).includes(raw)) {
    return { type: raw as Exclude<LocationType, "Place"> };
  }
  return { type: "Place", classification: classificationFromBackend(raw) };
};

/**
 * Maps keys prefixed with a Place classification ("Building:12", "Facility:12")
 * to "Place:12". Other prefixes, including the backend's "Location:" fallback
 * for an unknown indoor type, are left alone: Place and Location ids collide.
 */
export const normalizeLocationKey = (key: string): string => {
  const separator = key.indexOf(":");
  if (separator < 0) return key;
  const prefix = key.slice(0, separator);
  return isPlaceClassification(prefix) ? `Place:${key.slice(separator + 1)}` : key;
};

export const locationIdentityKey = (location: Pick<Location, "id" | "type">) =>
  `${location.type}:${location.id}`;

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
  | "outdoor_position_forbidden"
  | "floor_level_required"
  | "invalid_floor_level"
  | "unspecified_floor_forbidden"
  | "code_not_unique";

export interface LocationPolicyIssue {
  code: LocationPolicyIssueCode;
  field: keyof LocationDraft;
  message: string;
}

export interface LocationPolicyEvaluation {
  valid: boolean;
  issues: LocationPolicyIssue[];
}

export class LocationPolicyError extends Error {
  readonly issues: LocationPolicyIssue[];

  constructor(issues: LocationPolicyIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join(" "));
    this.name = "LocationPolicyError";
    this.issues = issues;
  }
}

export interface LocationPolicyOptions {
  context: LocationPolicyContext;
  directory: readonly Location[];
  /** New indoor records require a floor; legacy records may omit it. */
  requireFloorLevel?: boolean;
  /** Directory records use the controlled Floor Level vocabulary. */
  requireKnownFloorLevel?: boolean;
  /** The record being edited, which is allowed to retain its own code. */
  currentId?: string;
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
  const kind: LocationKind = type === "Place"
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
    (location) => location.id === draft.parentId && isLocationContainer(location),
  );
  const parentChanged = options.previous.parentId !== draft.parentId;

  return {
    ...draft,
    building: parent?.name,
    floor: classification.kind === "floor" || parentChanged ? undefined : draft.floor?.trim() || undefined,
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
    const parentRecord = options.directory.find((location) => location.id === draft.parentId);
    const parent = options.directory.find(
      (location) => location.id === draft.parentId && isLocationContainer(location),
    );

    if (!draft.parentId) {
      issues.push({
        code: "building_parent_required",
        field: "parentId",
        message: `${draft.type} Locations require a parent Building.`,
      });
    } else if (!parentRecord) {
      issues.push({
        code: "building_parent_not_found",
        field: "parentId",
        message: "The selected parent Location does not exist.",
      });
    } else if (!parent) {
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
      message: `${backendLocationType(draft)} Locations cannot belong to an indoor Building hierarchy.`,
    });
  }

  const duplicateCode = options.currentId !== undefined && options.directory.some((location) =>
    options.currentId === "__new__"
      ? location.code.trim().toLowerCase() === draft.code.trim().toLowerCase()
      : location.id !== options.currentId
        && location.code.trim().toLowerCase() === draft.code.trim().toLowerCase(),
  );
  if (draft.code.trim() && duplicateCode) {
    issues.push({
      code: "code_not_unique",
      field: "code",
      message: "Location code must be unique.",
    });
  }

  if (options.requireFloorLevel && isIndoorLocationType(draft.type) && !draft.floor?.trim()) {
    issues.push({
      code: "floor_level_required",
      field: "floor",
      message: "Indoor Locations require a Floor Level.",
    });
  }
  if (options.requireKnownFloorLevel && isIndoorLocationType(draft.type) && draft.floor?.trim() &&
      draft.floor.trim().toLowerCase() !== "unspecified floor" &&
      !(standardFloorLevels as readonly string[]).includes(draft.floor.trim())) {
    issues.push({
      code: "invalid_floor_level",
      field: "floor",
      message: `Floor Level must be one of: ${standardFloorLevels.join(", ")}.`,
    });
  }
  if (options.requireFloorLevel && isIndoorLocationType(draft.type) && draft.floor?.trim().toLowerCase() === "unspecified floor") {
    issues.push({
      code: "unspecified_floor_forbidden",
      field: "floor",
      message: "Unspecified Floor is only for legacy records and cannot be used for new records.",
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
      message: `${backendLocationType(draft)} Locations must remain unpositioned on the outdoor map.`,
    });
  }

  return { valid: issues.length === 0, issues };
};

export const locationPolicy: LocationPolicy = { classify, normalize, evaluate };
