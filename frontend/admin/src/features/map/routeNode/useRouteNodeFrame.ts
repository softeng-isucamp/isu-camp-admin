import { useState } from "react";
import type { RouteNode } from "../../../types";
import type { SavingAction } from "../session/useSavingAction";
import type { RouteNodeValidationContext, RouteNodeWorkflow } from "./RouteNodeWorkflow";

interface UseRouteNodeFrameOptions {
  workflow: RouteNodeWorkflow;
  saving: SavingAction;
  context: RouteNodeValidationContext;
  onNodeSaved: (node: RouteNode) => void;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
}

const REFRESH_FAILED = "Route Node was saved, but the map could not refresh. Retry the refresh before saving again.";

const fieldLabel = (field: string) =>
  field === "name" ? "Route Node name"
    : field === "nodeType" ? "Route Node type"
      : field === "association" ? "Route Node association"
        : "Route Node latitude";

/** Staged metadata edits (name, type, association) for the selected Route Node. */
export function useRouteNodeFrame(selectedNode: RouteNode | undefined, {
  workflow,
  saving,
  context,
  onNodeSaved,
  refreshMapData,
  onError,
}: UseRouteNodeFrameOptions) {
  const [draft, setDraft] = useState<RouteNode | null>(null);
  const [original, setOriginal] = useState<RouteNode | null>(null);

  const frame = selectedNode && draft?.id === selectedNode.id ? draft : selectedNode;
  const dirty = Boolean(draft && original && JSON.stringify(draft) !== JSON.stringify(original));

  /** Starts a clean frame for a node; null clears it. */
  const load = (node: RouteNode | null) => {
    setDraft(node ? { ...node } : null);
    setOriginal(node ? { ...node } : null);
  };

  const apply = async () => {
    if (!draft || !original || !dirty) return;
    if (!saving.beginSaving("route-node-metadata")) return;
    const result = await workflow.finalize({
      kind: "update",
      before: original,
      after: draft,
      context,
      description: `Edit ${draft.name}`,
    });
    if (!result.ok) {
      onError(result.message);
      const issue = result.issues?.[0];
      if (issue) {
        window.setTimeout(() => document.querySelector<HTMLElement>(`[aria-label="${fieldLabel(issue.field)}"]`)?.focus());
      }
      saving.endSaving();
      return;
    }
    const persisted = result.node;
    onNodeSaved(persisted);
    load(persisted);
    try {
      await refreshMapData();
      onError("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : REFRESH_FAILED);
    } finally {
      saving.endSaving();
    }
  };

  const cancel = () => {
    if (!original) return;
    setDraft({ ...original });
    onError("");
  };

  return { frame, dirty, stage: setDraft, load, apply, cancel };
}
