import { useCallback, useState } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import {
  findSelectionCandidates,
  type SelectionCandidate,
} from "../selectionCandidates";

export type MapSelectionType = "location" | "node" | "pathway" | "building" | "area" | "path_point";
export type MapSelection =
  | { type: "location"; id: string; locationType: Location["type"] }
  | { type: Exclude<MapSelectionType, "location">; id: string; locationType?: never };

export const locationSelection = (location: Pick<Location, "id" | "type">): MapSelection => ({
  type: "location",
  id: location.id,
  locationType: location.type,
});

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

  const selectObject = useCallback((selection: MapSelection) => {
    setSelected(selection);
    setPopover(null);
    onSelected(selection.type, selection.id);
  }, [onSelected, setSelected]);

  const selectCanvasObject = (selection: MapSelection, anchor: MapPoint) => {
    if (mode !== "select") {
      selectObject(selection);
      return;
    }
    const candidates = findSelectionCandidates(anchor, objects);
    if (candidates.length <= 1) {
      selectObject(selection);
      return;
    }
    setSelected(null);
    setPopover({ anchor, candidates });
  };

  const selectCandidate = (candidate: SelectionCandidate) => {
    selectObject(candidate.type === "location"
      ? { type: "location", id: candidate.id, locationType: candidate.locationType }
      : { type: candidate.type, id: candidate.id });
  };

  return { popover, clearPopover, selectObject, selectCanvasObject, selectCandidate };
}
