import type { Pathway } from "../../../types";
import type { MapSelection } from "../selection/useMapSelection";
import type { ActiveToolDraft, EditorMode, ToolType } from "../types";

/** The editor state the Map Editor owns and tool lifecycle events move. */
export interface EditorStateSetters {
  setMode: (mode: EditorMode) => void;
  setSelected: (selection: MapSelection | null) => void;
  setNetworkBrowserOpen: (open: boolean) => void;
}

/** The tool a mode belongs to; `place` and `move` are both the point tool. */
export function activeToolForMode(mode: EditorMode): ToolType {
  return mode === "place" || mode === "move"
    ? "point"
    : mode === "area"
      ? "polygon"
      : mode === "path"
        ? "pathway"
        : mode;
}

/** Moves the editor into the mode of a freshly activated tool. */
export function enterToolMode(
  toolType: ToolType,
  openedPathway: Pathway | null,
  { setMode, setSelected, setNetworkBrowserOpen }: EditorStateSetters,
) {
  const activationHandlers: Record<ToolType, () => void> = {
    select: () => setMode("select"),
    point: () => {
      setMode("place");
      setSelected(null);
    },
    polygon: () => setMode("area"),
    pathway: () => {
      setMode("path");
      setNetworkBrowserOpen(false);
      if (openedPathway) setSelected({ type: "pathway", id: openedPathway.id });
    },
  };
  activationHandlers[toolType]();
}

/** Moves the editor into the mode a restored Tool Draft was journaled in. */
export function restoreToolMode(
  toolType: ActiveToolDraft["toolType"],
  records: Record<string, unknown>,
  { setMode, setSelected }: Pick<EditorStateSetters, "setMode" | "setSelected">,
) {
  const restoreHandlers: Record<ActiveToolDraft["toolType"], () => void> = {
    point: () => {
      setMode(records.editorMode === "move" ? "move" : "place");
      const restoredSelection = records.selected;
      if (
        restoredSelection
        && typeof restoredSelection === "object"
        && "type" in restoredSelection
        && "id" in restoredSelection
        && restoredSelection.type === "node"
        && typeof restoredSelection.id === "string"
      ) setSelected({ type: restoredSelection.type, id: restoredSelection.id });
      else setSelected(null);
    },
    polygon: () => setMode("area"),
    pathway: () => setMode("path"),
  };
  restoreHandlers[toolType]();
}
