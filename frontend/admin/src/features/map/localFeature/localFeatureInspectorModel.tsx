import type { LocalMapFeatureEntity } from "../../../services/mapLayers";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { EDITABLE_LOCAL_FEATURE_FAMILIES } from "./localFeatures";

interface LocalFeatureInspectorOptions {
  feature: LocalMapFeatureEntity;
  actionNotice: string;
  onNotice: (notice: string) => void;
  onRestore: () => void;
  onEditDetails: () => void;
  onRetire: () => void;
}

export function localFeatureInspectorModel({
  feature,
  actionNotice,
  onNotice,
  onRestore,
  onEditDetails,
  onRetire,
}: LocalFeatureInspectorOptions): InspectorCardModel {
  const readOnly = !feature.isEditable || feature.family === "readonly_basemap";
  const retired = feature.status === "retired";
  const disabledReason = "Imported basemap context cannot be edited in the Map Editor.";
  const family = EDITABLE_LOCAL_FEATURE_FAMILIES.find((candidate) => candidate.id === feature.family);
  return {
    id: feature.id,
    kind: "local_map_feature",
    title: feature.name,
    domain: "Local Map Data",
    status: readOnly ? "Imported context feature" : retired ? "Retired in Working Session" : family?.label,
    readOnly,
    summary: [
      { label: "Feature Family", value: feature.family.replaceAll("_", " ") },
      { label: "Geometry", value: feature.geometryType },
      { label: "Area / Length", value: feature.areaOrLength ?? "—" },
      { label: "Lifecycle", value: feature.status ?? "active" },
    ],
    details: (
      <>
        {retired && (
          <div className="inspector-retired-warning" role="alert" aria-label="Retired Local Map Feature">
            ⚠ This feature is retired in this Working Session. It remains recoverable until save.
          </div>
        )}
        {actionNotice && <p className="inspector-action-notice" role="status">{actionNotice}</p>}
      </>
    ),
    primaryAction: {
      label: readOnly
        ? "▱ Reshape Boundary"
        : retired
          ? "⎌ Restore Feature"
          : `${family?.icon ?? "▱"} Reshape ${family?.label ?? "Feature"}`,
      disabled: readOnly,
      disabledReason: readOnly ? disabledReason : undefined,
      onSelect: retired
        ? onRestore
        : () => onNotice(`${family?.label ?? "Local feature"} geometry is ready for reshaping.`),
    },
    overflowActions: retired ? [] : [
      {
        label: "✎ Edit Details",
        disabled: readOnly,
        disabledReason: readOnly ? disabledReason : undefined,
        onSelect: onEditDetails,
      },
      {
        label: "🗑 Retire Feature",
        tone: "danger" as const,
        disabled: readOnly,
        disabledReason: readOnly ? disabledReason : undefined,
        onSelect: onRetire,
      },
    ],
    provenance: feature.provenance,
  } satisfies InspectorCardModel;
}
