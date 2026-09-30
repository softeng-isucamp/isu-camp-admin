import { useEffect, useMemo, useState } from "react";
import type { Pathway } from "../../../types";
import type { useBuildingFootprintEditing } from "../building/useBuildingFootprintEditing";
import type { usePathwayEditing } from "../pathway/usePathwayEditing";
import type { useRouteNodePointTool } from "../routeNode/useRouteNodePointTool";
import type { ActiveToolDraft, ToolType } from "../types";
import type { WorkingSessionJournal, WorkingSessionKey } from "../WorkingSessionJournal";
import type { WorkingSessionManager } from "../WorkingSessionManager";

export interface PendingToolRequest {
  toolType: ToolType;
  resumeDraftId?: string;
  openNetworkBrowser?: boolean;
}

/** The tools whose drafts the Working Session persists. */
export interface SessionTools {
  point: ReturnType<typeof useRouteNodePointTool>;
  polygon: ReturnType<typeof useBuildingFootprintEditing>;
  pathway: ReturnType<typeof usePathwayEditing>;
}

interface UseToolSessionOptions {
  manager: WorkingSessionManager;
  journal: WorkingSessionJournal;
  /** Null until an administrator is signed in; nothing is recovered or journaled without it. */
  key: WorkingSessionKey | null;
  activeTool: ToolType;
  tools: SessionTools;
  /** The tool was activated with a fresh draft; the caller moves to its editor mode. */
  onToolActivated: (toolType: ToolType, openedPathway: Pathway | null) => void;
  /** A suspended or recovered Tool Draft was restored into its tool; the caller moves to its editor mode. */
  onDraftRestored: (toolType: ActiveToolDraft["toolType"], records: Record<string, unknown>) => void;
  onOpenNetworkBrowser: () => void;
}

/**
 * The Working Session's tool lifecycle: recovering the journaled session,
 * persisting the active Tool Draft, and switching, suspending or resuming
 * drafts through the Tool Interruption flow. The caller owns editor mode and
 * selection and reacts to activations and restores.
 */
export function useToolSession({
  manager,
  journal,
  key,
  activeTool,
  tools,
  onToolActivated,
  onDraftRestored,
  onOpenNetworkBrowser,
}: UseToolSessionOptions) {
  const { point, polygon, pathway } = tools;
  const [, setRevision] = useState(0);
  const [pendingToolRequest, setPendingToolRequest] = useState<PendingToolRequest | null>(null);

  useEffect(
    () => manager.subscribe(() => {
      setRevision((revision) => revision + 1);
    }),
    [manager],
  );

  useEffect(() => {
    if (!key) return undefined;
    const stored = journal.load(key);
    if (stored) {
      manager.hydrate(stored.snapshot);
      const recoveredDraft = manager.getActiveDraft();
      if (recoveredDraft) restoreDraft(recoveredDraft);
    }

    const saveRecovery = () => journal.save(key, {
      schemaVersion: 1,
      snapshot: manager.exportSnapshot(),
    });
    saveRecovery();
    return manager.subscribe(saveRecovery);
  }, [journal, key, manager]);

  const draftSnapshot = useMemo<Omit<ActiveToolDraft, "id" | "isSuspended"> | null>(() => {
    type DraftSnapshot = Omit<ActiveToolDraft, "id" | "isSuspended">;
    const snapshotBuilders: Record<ToolType, () => DraftSnapshot | null> = {
      select: () => null,
      point: () => point.draftSnapshot,
      polygon: () => polygon.draftSnapshot,
      pathway: () => pathway.draftSnapshot,
    };
    return snapshotBuilders[activeTool]();
  }, [
    activeTool,
    point.draftSnapshot,
    polygon.draftSnapshot,
    pathway.draftSnapshot,
  ]);

  useEffect(() => {
    const activeDraft = manager.getActiveDraft();
    if (!draftSnapshot) {
      if (activeDraft && (activeDraft.toolType === activeTool || activeTool === "select")) {
        manager.discardActiveDraft();
      }
      return;
    }
    if (!activeDraft) {
      manager.startDraft(draftSnapshot);
    } else if (activeDraft.toolType === draftSnapshot.toolType) {
      manager.updateDraft(draftSnapshot);
    }
  }, [activeTool, draftSnapshot, manager]);

  const clearDraftGeometry = (toolType: Exclude<ToolType, "select">) => {
    const clearHandlers: Record<Exclude<ToolType, "select">, () => void> = {
      point: () => point.reset(),
      polygon: () => polygon.clearToolDraft(),
      pathway: () => pathway.clearToolDraft(),
    };
    clearHandlers[toolType]();
  };

  const activateTool = (toolType: ToolType) => {
    const activationHandlers: Record<ToolType, () => Pathway | null> = {
      select: () => {
        point.reset();
        return null;
      },
      point: () => {
        point.activatePlacement();
        return null;
      },
      polygon: () => {
        polygon.activate();
        return null;
      },
      pathway: () => pathway.activate(),
    };
    onToolActivated(toolType, activationHandlers[toolType]());
  };

  function restoreDraft(draft: ActiveToolDraft) {
    const restoredPoints = (draft.provisionalGeometry.points ?? []).map((draftPoint) => [
      draftPoint.lat ?? draftPoint.y,
      draftPoint.lng ?? draftPoint.x,
    ] as [number, number]);
    const records = draft.nestedRecords ?? {};

    const restoreHandlers: Record<ActiveToolDraft["toolType"], () => void> = {
      point: () => point.restoreDraft(restoredPoints[0] ?? null, records),
      polygon: () => polygon.restoreDraft(restoredPoints, records),
      pathway: () => pathway.restoreDraft(restoredPoints, draft.provisionalGeometry.startNodeId, records),
    };
    restoreHandlers[draft.toolType]();
    onDraftRestored(draft.toolType, records);
  }

  const restoreSuspendedDraft = (draftId: string) => {
    const draft = manager.resumeSuspendedDraft(draftId);
    if (draft) restoreDraft(draft);
  };

  /** Runs the request now, or asks the administrator first when a Tool Draft is active. */
  const requestTool = (request: PendingToolRequest) => {
    if (manager.hasActiveDraft()) {
      setPendingToolRequest(request);
      return;
    }
    if (request.resumeDraftId) restoreSuspendedDraft(request.resumeDraftId);
    else activateTool(request.toolType);
    if (request.openNetworkBrowser) onOpenNetworkBrowser();
  };

  const requestDraftResume = (draftId: string) => {
    const draft = manager.getSuspendedDrafts().find((item) => item.id === draftId);
    if (!draft) return;
    requestTool({ toolType: draft.toolType, resumeDraftId: draftId });
  };

  const finishInterruption = (action: "keep_draft" | "discard_geometry") => {
    if (!pendingToolRequest) return;
    const currentDraft = manager.getActiveDraft();
    if (!currentDraft) return;
    manager.handleInterruption(action);
    clearDraftGeometry(currentDraft.toolType);
    const request = pendingToolRequest;
    setPendingToolRequest(null);
    if (request.resumeDraftId) restoreSuspendedDraft(request.resumeDraftId);
    else activateTool(request.toolType);
    if (request.openNetworkBrowser) onOpenNetworkBrowser();
  };

  return {
    state: manager.getState(),
    pendingToolRequest,
    activateTool,
    requestTool,
    requestDraftResume,
    finishInterruption,
    cancelInterruption: () => setPendingToolRequest(null),
  };
}
