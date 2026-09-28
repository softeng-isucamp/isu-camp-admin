import { useCallback, useMemo, useState } from "react";
import { overlayChanges } from "../mapEditing";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapLayers";

const withReplacement = <T extends { id: string }>(items: T[], entityId: string, value: Record<string, unknown> | null) =>
  value === null
    ? items.filter((item) => item.id !== entityId)
    : [...items.filter((item) => item.id !== entityId), value as unknown as T];

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

  /** Applies an undo/redo projection; `null` removes the entity from the overlay. */
  const projectFeature = useCallback((entityId: string, value: Record<string, unknown> | null) => {
    setFeatureChanges((items) => withReplacement(items, entityId, value));
  }, []);

  const projectFeatureLink = useCallback((entityId: string, value: Record<string, unknown> | null) => {
    setAddedFeatureLinks((items) => withReplacement(items, entityId, value));
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
    projectFeature,
    projectFeatureLink,
    reset,
  };
}

export type LocalFeatureLayer = ReturnType<typeof useLocalFeatureLayer>;
