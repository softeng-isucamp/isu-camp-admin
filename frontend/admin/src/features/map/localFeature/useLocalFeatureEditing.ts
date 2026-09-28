import { useMemo, useState } from "react";
import type { LocalMapFeatureEntity } from "../../../services/mapLayers";
import type { WorkingSessionManager } from "../WorkingSessionManager";
import { createLocalMapFeatureWorkflow } from "./LocalMapFeatureWorkflow";
import type { LocalFeatureLayer } from "./useLocalFeatureLayer";

interface UseLocalFeatureEditingOptions {
  workingSession: WorkingSessionManager;
  layer: LocalFeatureLayer;
  onError: (message: string) => void;
}

/** Local Map Feature lifecycle commands (update, retire, restore) applied to the feature layer. */
export function useLocalFeatureEditing({ workingSession, layer, onError }: UseLocalFeatureEditingOptions) {
  const workflow = useMemo(() => createLocalMapFeatureWorkflow({ workingSession }), [workingSession]);
  const [actionNotice, setActionNotice] = useState("");

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
  };

  return {
    actionNotice,
    setActionNotice,
    updateFeature,
    retireFeature: (feature: LocalMapFeatureEntity) => setRetired(feature, true),
    restoreFeature: (feature: LocalMapFeatureEntity) => setRetired(feature, false),
  };
}
