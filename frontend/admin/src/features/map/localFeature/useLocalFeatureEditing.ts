import { useCallback, useMemo, useState } from "react";
import type { LocalFeatureFamily, LocalMapFeatureEntity } from "../../../services/mapEditorApiClient";
import type { ActiveToolDraft } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";
import { EDITABLE_LOCAL_FEATURE_FAMILIES } from "./localFeatures";
import { createLocalMapFeatureWorkflow } from "./LocalMapFeatureWorkflow";
import type { LocalFeatureLayer } from "./useLocalFeatureLayer";

type EditableFamily = Exclude<LocalFeatureFamily, "readonly_basemap">;

const RESTORABLE_FAMILIES: readonly unknown[] = [
  "building_footprint",
  "parking_area",
  "cartographic_walkway",
  "vehicle_path",
  "campus_boundary",
] satisfies EditableFamily[];

interface UseLocalFeatureEditingOptions {
  workingSession: WorkingSessionManager;
  layer: LocalFeatureLayer;
  onError: (message: string) => void;
  onDirty: () => void;
}

/**
 * Local Map Feature editing: the draw-tool draft (family, name, points) and the
 * lifecycle commands (update, retire, restore) applied to the feature layer.
 */
export function useLocalFeatureEditing({ workingSession, layer, onError, onDirty }: UseLocalFeatureEditingOptions) {
  const workflow = useMemo(() => createLocalMapFeatureWorkflow({ workingSession }), [workingSession]);
  const [family, setFamily] = useState<EditableFamily>("parking_area");
  const [points, setPoints] = useState<[number, number][]>([]);
  const [name, setName] = useState("New Parking Area");
  const [actionNotice, setActionNotice] = useState("");
  const definition = EDITABLE_LOCAL_FEATURE_FAMILIES.find((candidate) => candidate.id === family)!;

  const draftSnapshot = useMemo<Omit<ActiveToolDraft, "id" | "isSuspended"> | null>(() => points.length > 0 ? ({
    toolType: "local_feature",
    label: `${definition.label} draft`,
    provisionalGeometry: {
      points: points.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
      isClosed: definition.geometryType === "polygon",
    },
    nestedRecords: { family, name },
  }) : null, [definition.geometryType, definition.label, family, name, points]);

  const addPoint = useCallback((point: [number, number]) => setPoints((current) => [...current, point]), []);
  const clearPoints = useCallback(() => setPoints([]), []);

  const restoreDraft = useCallback((records: Record<string, unknown>, restoredPoints: [number, number][]) => {
    if (RESTORABLE_FAMILIES.includes(records.family)) setFamily(records.family as EditableFamily);
    if (typeof records.name === "string") setName(records.name);
    setPoints(restoredPoints);
  }, []);

  const resetDraft = useCallback(() => {
    setPoints([]);
    setName("New Parking Area");
  }, []);

  /** Returns whether the update was accepted. */
  const updateFeature = (before: LocalMapFeatureEntity, after: LocalMapFeatureEntity) => {
    const result = workflow.finalize({ kind: "update", before, after });
    if (!result.ok) {
      onError(result.message);
      return false;
    }
    layer.putFeature(result.feature);
    return true;
  };

  const setRetired = (feature: LocalMapFeatureEntity, retired: boolean) => {
    const featureLink = layer.knownFeatureLinks.find((link) => link.featureId === feature.id);
    const result = workflow.finalize({ kind: retired ? "retire" : "restore", feature, link: featureLink });
    if (!result.ok) {
      onError(result.message);
      return;
    }
    layer.putFeature(result.feature);
    if (featureLink) layer.setLinkUnlinked(featureLink.id, retired);
    onDirty();
  };

  return {
    draftSnapshot,
    addPoint,
    clearPoints,
    restoreDraft,
    resetDraft,
    actionNotice,
    setActionNotice,
    updateFeature,
    retireFeature: (feature: LocalMapFeatureEntity) => setRetired(feature, true),
    restoreFeature: (feature: LocalMapFeatureEntity) => setRetired(feature, false),
  };
}
