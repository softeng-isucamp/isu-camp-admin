import { useCallback, useState } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import {
  findSelectionCandidates,
  type CanvasSelectionType,
  type SelectionCandidate,
} from "../selectionCandidates";

export type MapSelectionType = "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature";
export type MapSelection = { type: MapSelectionType; id: string };

export interface SelectionPopoverState {
  anchor: MapPoint;
  candidates: SelectionCandidate[];
}

export interface SelectableMapObjects {
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
  buildings: Building[];
}

/**
 * Selecting map objects, including the popover that disambiguates overlapping
 * objects under a canvas click. MapEditor owns `mode` and `selected`;
 * `onSelected` runs after each selection so domains can load their drafts.
 */
export function useMapSelection(
  mode: EditorMode,
  setSelected: (selection: MapSelection | null) => void,
  objects: SelectableMapObjects,
  onSelected: (type: MapSelectionType, id: string) => void,
) {
  const [popover, setPopover] = useState<SelectionPopoverState | null>(null);
  const clearPopover = useCallback(() => setPopover(null), []);

  const selectObject = useCallback((type: MapSelectionType, id: string) => {
    setSelected({ type, id });
    setPopover(null);
    onSelected(type, id);
  }, [onSelected, setSelected]);

  const selectCanvasObject = (type: CanvasSelectionType, id: string, anchor: MapPoint) => {
    if (mode !== "select") {
      selectObject(type, id);
      return;
    }
    const candidates = findSelectionCandidates(anchor, objects);
    if (candidates.length <= 1) {
      selectObject(type, id);
      return;
    }
    setSelected(null);
    setPopover({ anchor, candidates });
  };

  return { popover, clearPopover, selectObject, selectCanvasObject };
}
