import type {
  FeatureLinkEntity,
  LocalFeatureFamily,
  LocalMapFeatureEntity,
} from "../../services/mapEditorApiClient";
import {
  compoundBatchOperation,
  linkFeatureOperation,
  restoreEntityOperation,
  retireEntityOperation,
  unlinkFeatureOperation,
} from "./WorkingSessionManager";
import type { WorkingOperation } from "./types";

export const LOCAL_FEATURE_SURFACES = [
  "unknown",
  "asphalt",
  "concrete",
  "paved",
  "gravel",
  "grass",
] as const;
export const LOCAL_FEATURE_ACCESS = [
  "unknown",
  "yes",
  "campus_only",
  "destination_only",
  "private",
  "closed",
] as const;
export const LOCAL_FEATURE_DIRECTIONS = [
  "both",
  "forward",
  "reverse",
] as const;

export type LocalFeatureSurface = (typeof LOCAL_FEATURE_SURFACES)[number];
export type LocalFeatureAccess = (typeof LOCAL_FEATURE_ACCESS)[number];
export type LocalFeatureDirection = (typeof LOCAL_FEATURE_DIRECTIONS)[number];

export function normalizeCuratedLocalFeatureProperties(
  feature: LocalMapFeatureEntity,
): LocalMapFeatureEntity {
  return {
    ...feature,
    surface: LOCAL_FEATURE_SURFACES.includes(feature.surface as LocalFeatureSurface)
      ? feature.surface
      : "unknown",
    access: LOCAL_FEATURE_ACCESS.includes(feature.access as LocalFeatureAccess)
      ? feature.access
      : "unknown",
    direction: LOCAL_FEATURE_DIRECTIONS.includes(feature.direction as LocalFeatureDirection)
      ? feature.direction
      : "both",
  };
}

export interface EditableLocalFeatureFamilyDefinition {
  id: Exclude<LocalFeatureFamily, "readonly_basemap">;
  label: string;
  icon: string;
  geometryType: "polygon" | "line";
  instruction: string;
  style: {
    color: string;
    fillColor: string;
    dashArray?: string;
    weight: number;
  };
}

export const EDITABLE_LOCAL_FEATURE_FAMILIES: EditableLocalFeatureFamilyDefinition[] = [
  {
    id: "building_footprint",
    label: "Building Footprint",
    icon: "▱",
    geometryType: "polygon",
    instruction: "Draw a Building footprint and attach it to a Building record.",
    style: { color: "#087451", fillColor: "#8fd1bd", weight: 3 },
  },
  {
    id: "parking_area",
    label: "Parking Area",
    icon: "P",
    geometryType: "polygon",
    instruction: "Draw the boundary of a surface parking area.",
    style: { color: "#2563eb", fillColor: "#bfdbfe", weight: 2 },
  },
  {
    id: "cartographic_walkway",
    label: "Walkway",
    icon: "⋯",
    geometryType: "line",
    instruction: "Draw pedestrian cartography without changing the routing network.",
    style: { color: "#059669", fillColor: "#a7f3d0", dashArray: "5 5", weight: 5 },
  },
  {
    id: "vehicle_path",
    label: "Vehicle Path",
    icon: "━",
    geometryType: "line",
    instruction: "Draw a cartographic vehicle way without topology semantics.",
    style: { color: "#475569", fillColor: "#cbd5e1", weight: 7 },
  },
  {
    id: "campus_boundary",
    label: "Campus Boundary",
    icon: "⬡",
    geometryType: "polygon",
    instruction: "Edit the authoritative campus extent.",
    style: { color: "#d97706", fillColor: "#fef3c7", dashArray: "10 6", weight: 3 },
  },
];

const familyDefinitions = new Map(
  EDITABLE_LOCAL_FEATURE_FAMILIES.map((definition) => [definition.id, definition]),
);

export function getLocalFeaturePathOptions(
  feature: LocalMapFeatureEntity,
  selected: boolean,
) {
  const definition = feature.family === "readonly_basemap"
    ? undefined
    : familyDefinitions.get(feature.family);
  const readOnly = feature.family === "readonly_basemap" || !feature.isEditable;
  const retired = feature.status === "retired";
  return {
    className: `local-feature-${feature.id}`,
    color: selected ? "#e67e22" : readOnly ? "#377d9b" : definition?.style.color ?? "#4f7f67",
    fillColor: readOnly ? "#74b9d1" : definition?.style.fillColor ?? "#aab2b8",
    fillOpacity: retired ? 0.1 : selected ? 0.42 : 0.24,
    opacity: retired ? 0.48 : 1,
    weight: selected ? Math.max(4, definition?.style.weight ?? 2) : definition?.style.weight ?? 2,
    dashArray: retired ? "7 6" : readOnly ? "5 5" : definition?.style.dashArray,
  };
}

export function buildRetireLocalFeatureOperation(
  feature: LocalMapFeatureEntity,
  link?: FeatureLinkEntity,
): WorkingOperation {
  const retire = retireEntityOperation(
    "Local Map Data",
    feature.id,
    feature as unknown as Record<string, unknown>,
    `Retire ${feature.name}`,
  );
  if (!link) return retire;
  return compoundBatchOperation(
    "Local Map Data",
    feature.id,
    [
      retire,
      unlinkFeatureOperation(
        "Local Map Data",
        link.id,
        link as unknown as Record<string, unknown>,
        `Unlink ${feature.name} from Building`,
      ),
    ],
    `Retire and unlink ${feature.name}`,
  );
}

export function buildRestoreLocalFeatureOperation(
  feature: LocalMapFeatureEntity,
  link?: FeatureLinkEntity,
): WorkingOperation {
  const restore = restoreEntityOperation(
    "Local Map Data",
    feature.id,
    feature as unknown as Record<string, unknown>,
    `Restore ${feature.name}`,
  );
  if (!link) return restore;
  return compoundBatchOperation(
    "Local Map Data",
    feature.id,
    [
      restore,
      linkFeatureOperation(
        "Local Map Data",
        link.id,
        link as unknown as Record<string, unknown>,
        `Relink ${feature.name} to Building`,
      ),
    ],
    `Restore and relink ${feature.name}`,
  );
}
