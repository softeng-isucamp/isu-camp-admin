import { useCallback, useMemo, useState } from "react";
import { overlayChanges } from "../mapEditing";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapLayers";

/**
 * Working-session overlay for Local Map Features and their Feature Links:
 * unsaved feature changes, new links, and links unlinked in this session.
 */
export function useLocalFeatureLayer(directoryFeatureLinks: FeatureLinkEntity[]) {
  const [featureChanges, setFeatureChanges] = useState<LocalMapFeatureEntity[]>([]);
  const [addedFeatureLinks, setAddedFeatureLinks] = useState<FeatureLinkEntity[]>([]);
  const [unlinkedFeatureLinkIds, setUnlinkedFeatureLinkIds] = useState<string[]>([]);

  /** Every link known in this session, including ones unlinked in it. */
  const knownFeatureLinks = [...directoryFeatureLinks, ...addedFeatureLinks];
  const currentFeatureLinks = knownFeatureLinks.filter((link) => !unlinkedFeatureLinkIds.includes(link.id));

  const putFeature = useCallback((feature: LocalMapFeatureEntity) => {
    setFeatureChanges((items) => [...items.filter((item) => item.id !== feature.id), feature]);
  }, []);

  const putBuildingLink = useCallback((link: FeatureLinkEntity) => {
    setAddedFeatureLinks((items) => [...items.filter((item) => item.targetEntityId !== link.targetEntityId), link]);
  }, []);

  const setLinkUnlinked = useCallback((linkId: string, unlinked: boolean) => {
    setUnlinkedFeatureLinkIds((ids) => unlinked ? [...new Set([...ids, linkId])] : ids.filter((id) => id !== linkId));
  }, []);

  const reset = useCallback(() => {
    setFeatureChanges([]);
    setAddedFeatureLinks([]);
    setUnlinkedFeatureLinkIds([]);
  }, []);

  const withFeatureChanges = useMemo(
    () => (features: LocalMapFeatureEntity[]) => overlayChanges(features, featureChanges),
    [featureChanges],
  );

  return {
    knownFeatureLinks,
    currentFeatureLinks,
    withFeatureChanges,
    putFeature,
    putBuildingLink,
    setLinkUnlinked,
    reset,
  };
}

export type LocalFeatureLayer = ReturnType<typeof useLocalFeatureLayer>;
