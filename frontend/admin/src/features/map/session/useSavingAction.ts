import { useCallback, useRef, useState } from "react";

export type SaveAction =
  | "route-node"
  | "position"
  | "pathway"
  | "building"
  | "route-node-metadata"
  | "pathway-metadata"
  | "path-point-conversion";

/** A single-flight lock: at most one save runs at a time across the editor. */
export function useSavingAction() {
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null);
  const savingActionRef = useRef<SaveAction | null>(null);

  /** Returns false when another save is already running. */
  const beginSaving = useCallback((action: SaveAction) => {
    if (savingActionRef.current) return false;
    savingActionRef.current = action;
    setSavingAction(action);
    return true;
  }, []);

  const endSaving = useCallback(() => {
    savingActionRef.current = null;
    setSavingAction(null);
  }, []);

  return { savingAction, beginSaving, endSaving };
}

export type SavingAction = ReturnType<typeof useSavingAction>;
