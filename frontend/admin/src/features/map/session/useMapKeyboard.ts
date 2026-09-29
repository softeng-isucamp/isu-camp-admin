import { useEffect } from "react";
import { pointOnCampus, type MapPoint } from "../campusBoundary";
import { nudgePoint } from "../pointInteractions";
import type { useRouteNodePointTool } from "../routeNode/useRouteNodePointTool";
import type { EditorMode, ToolType } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";
import type { useToolSession } from "./useToolSession";

interface UsePointMoveKeysOptions {
  mode: EditorMode;
  pointTool: ReturnType<typeof useRouteNodePointTool>;
  campusBoundary: MapPoint[];
  onCancel: () => void;
  onSave: () => void;
}

/** Keyboard control of a Route Node move: Escape cancels, Enter saves, arrows nudge. */
export function usePointMoveKeys({ mode, pointTool, campusBoundary, onCancel, onSave }: UsePointMoveKeysOptions) {
  useEffect(() => {
    const position = pointTool.position;
    if (mode !== "move" || !position) return;
    const handlePointMoveKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pointOnCampus(position, campusBoundary)) onSave();
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement | null)?.tagName ?? "")) return;
      const directions = {
        ArrowUp: "north",
        ArrowDown: "south",
        ArrowLeft: "west",
        ArrowRight: "east",
      } as const;
      const direction = directions[event.key as keyof typeof directions];
      if (!direction) return;
      event.preventDefault();
      pointTool.updateMovePosition(nudgePoint(position, direction, event.shiftKey ? 5 : 0.5));
    };
    window.addEventListener("keydown", handlePointMoveKey);
    return () => window.removeEventListener("keydown", handlePointMoveKey);
  }, [campusBoundary, mode, pointTool.position]);
}

interface UseEscapeShortcutOptions {
  mode: EditorMode;
  activeTool: ToolType;
  toolSession: ReturnType<typeof useToolSession>;
  workingSession: WorkingSessionManager;
  onClearSelection: () => void;
}

/** Escape unwinds one level: pending interruption, active draft, active tool, then selection. */
export function useEscapeShortcut({
  mode,
  activeTool,
  toolSession,
  workingSession,
  onClearSelection,
}: UseEscapeShortcutOptions) {
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mode === "move") return;
      if (toolSession.pendingToolRequest) {
        toolSession.cancelInterruption();
      } else if (workingSession.hasActiveDraft()) {
        toolSession.requestTool({ toolType: "select" });
      } else if (activeTool !== "select") {
        toolSession.activateTool("select");
      } else {
        onClearSelection();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [activeTool, mode, toolSession.pendingToolRequest, workingSession]);
}
