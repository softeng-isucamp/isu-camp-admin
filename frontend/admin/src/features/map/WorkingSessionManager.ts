import { useSyncExternalStore, useEffect } from "react";
import type {
  ActiveToolDraft,
  InterruptionAction,
  SpatialDomain,
  WorkingOperation,
  WorkingOperationType,
  WorkingSessionState,
} from "./types";

let operationIdCounter = 0;
function generateOperationId(prefix = "op"): string {
  operationIdCounter += 1;
  return `${prefix}-${Date.now()}-${operationIdCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Pure state container managing the operation-based undo/redo stack,
 * dirtiness tracking, tool draft lifecycle, and 3-way interruption draft safety.
 */
export class WorkingSessionManager {
  private pastOperations: WorkingOperation[] = [];
  private futureOperations: WorkingOperation[] = [];
  private activeDraft: ActiveToolDraft | null = null;
  private suspendedDrafts: ActiveToolDraft[] = [];
  private savedCheckpointIndex: number = 0;
  private listeners: Set<(state: WorkingSessionState) => void> = new Set();

  constructor(initialOperations: WorkingOperation[] = []) {
    if (initialOperations.length > 0) {
      this.pastOperations = [...initialOperations];
      this.savedCheckpointIndex = this.pastOperations.length;
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions & State Snapshot
  // ---------------------------------------------------------------------------

  public getState(): WorkingSessionState {
    return {
      pastOperations: [...this.pastOperations],
      futureOperations: [...this.futureOperations],
      activeDraft: this.activeDraft ? { ...this.activeDraft } : null,
      suspendedDrafts: this.suspendedDrafts.map((d) => ({ ...d })),
      isDirty: this.getIsDirty(),
      uncommittedCount: this.getUncommittedCount(),
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  public subscribe(listener: (state: WorkingSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error("Error in WorkingSessionManager listener:", err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Operations & Undo/Redo Stack
  // ---------------------------------------------------------------------------

  public executeOperation(
    operation: Omit<WorkingOperation, "id"> & { id?: string }
  ): WorkingOperation {
    const op: WorkingOperation = {
      ...operation,
      id: operation.id ?? generateOperationId("op"),
      timestamp: operation.timestamp ?? Date.now(),
    };

    this.pastOperations.push(op);
    this.futureOperations = [];
    this.notify();
    return op;
  }

  public executeBatch(
    description: string,
    domain: SpatialDomain,
    entityId: string,
    nestedOperations: WorkingOperation[]
  ): WorkingOperation {
    const batchOp: WorkingOperation = {
      id: generateOperationId("batch"),
      type: "compound_batch",
      domain,
      entityId,
      description,
      before: null,
      after: null,
      nestedOperations: [...nestedOperations],
      timestamp: Date.now(),
    };

    return this.executeOperation(batchOp);
  }

  public undo(): WorkingOperation | null {
    if (!this.canUndo()) return null;
    const op = this.pastOperations.pop()!;
    this.futureOperations.push(op);
    this.notify();
    return op;
  }

  public redo(): WorkingOperation | null {
    if (!this.canRedo()) return null;
    const op = this.futureOperations.pop()!;
    this.pastOperations.push(op);
    this.notify();
    return op;
  }

  public canUndo(): boolean {
    return this.pastOperations.length > 0;
  }

  public canRedo(): boolean {
    return this.futureOperations.length > 0;
  }

  public getPastOperations(): readonly WorkingOperation[] {
    return this.pastOperations;
  }

  public getFutureOperations(): readonly WorkingOperation[] {
    return this.futureOperations;
  }

  // ---------------------------------------------------------------------------
  // Dirtiness & Checkpoint Tracking
  // ---------------------------------------------------------------------------

  public get isDirty(): boolean {
    return this.getIsDirty();
  }

  public getIsDirty(): boolean {
    return this.pastOperations.length !== this.savedCheckpointIndex;
  }

  public getUncommittedCount(): number {
    return Math.max(0, this.pastOperations.length - this.savedCheckpointIndex);
  }

  public getUncommittedOperations(): WorkingOperation[] {
    return this.pastOperations.slice(this.savedCheckpointIndex);
  }

  public markClean(): void {
    this.savedCheckpointIndex = this.pastOperations.length;
    this.notify();
  }

  public markSaved(): void {
    this.markClean();
  }

  public reset(): void {
    this.pastOperations = [];
    this.futureOperations = [];
    this.activeDraft = null;
    this.suspendedDrafts = [];
    this.savedCheckpointIndex = 0;
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Active Tool Draft & Interruption State Machine
  // ---------------------------------------------------------------------------

  public getActiveDraft(): ActiveToolDraft | null {
    return this.activeDraft;
  }

  public hasActiveDraft(): boolean {
    return this.activeDraft !== null;
  }

  public startDraft(
    draft: Omit<ActiveToolDraft, "isSuspended" | "id"> & {
      id?: string;
      isSuspended?: boolean;
    }
  ): ActiveToolDraft {
    const newDraft: ActiveToolDraft = {
      ...draft,
      id: draft.id ?? generateOperationId("draft"),
      isSuspended: false,
      createdAt: draft.createdAt ?? Date.now(),
    };
    this.activeDraft = newDraft;
    this.notify();
    return newDraft;
  }

  public updateDraft(updates: Partial<ActiveToolDraft>): ActiveToolDraft | null {
    if (!this.activeDraft) return null;
    this.activeDraft = {
      ...this.activeDraft,
      ...updates,
      provisionalGeometry: {
        ...this.activeDraft.provisionalGeometry,
        ...(updates.provisionalGeometry ?? {}),
      },
      nestedRecords: {
        ...this.activeDraft.nestedRecords,
        ...(updates.nestedRecords ?? {}),
      },
    };
    this.notify();
    return this.activeDraft;
  }

  public discardActiveDraft(): void {
    this.activeDraft = null;
    this.notify();
  }

  /**
   * 3-way Tool Interruption State Machine:
   * - `keep_draft`: Suspends current geometry into shelf, clears active draft (or transitions to pending).
   * - `continue_editing`: Retains current active draft, no state change.
   * - `discard_geometry`: Cleans up in-progress drawing without leaving orphan records.
   */
  public handleInterruption(
    action: InterruptionAction,
    pendingDraft?: ActiveToolDraft | null
  ): {
    actionTaken: InterruptionAction;
    activeDraft: ActiveToolDraft | null;
    suspendedDraft: ActiveToolDraft | null;
  } {
    if (action === "keep_draft") {
      let suspended: ActiveToolDraft | null = null;
      if (this.activeDraft) {
        suspended = {
          ...this.activeDraft,
          isSuspended: true,
        };
        const existingIdx = this.suspendedDrafts.findIndex(
          (d) => d.id === suspended!.id
        );
        if (existingIdx >= 0) {
          this.suspendedDrafts[existingIdx] = suspended;
        } else {
          this.suspendedDrafts.push(suspended);
        }
      }
      this.activeDraft = pendingDraft ?? null;
      this.notify();
      return {
        actionTaken: "keep_draft",
        activeDraft: this.activeDraft,
        suspendedDraft: suspended,
      };
    }

    if (action === "continue_editing") {
      return {
        actionTaken: "continue_editing",
        activeDraft: this.activeDraft,
        suspendedDraft: null,
      };
    }

    if (action === "discard_geometry") {
      this.activeDraft = pendingDraft ?? null;
      this.notify();
      return {
        actionTaken: "discard_geometry",
        activeDraft: this.activeDraft,
        suspendedDraft: null,
      };
    }

    return {
      actionTaken: action,
      activeDraft: this.activeDraft,
      suspendedDraft: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Suspended Drafts Shelf
  // ---------------------------------------------------------------------------

  public getSuspendedDrafts(): readonly ActiveToolDraft[] {
    return this.suspendedDrafts;
  }

  public addSuspendedDraft(draft: ActiveToolDraft): void {
    const suspended = { ...draft, isSuspended: true };
    const existingIndex = this.suspendedDrafts.findIndex((d) => d.id === draft.id);
    if (existingIndex >= 0) {
      this.suspendedDrafts[existingIndex] = suspended;
    } else {
      this.suspendedDrafts.push(suspended);
    }
    this.notify();
  }

  public removeSuspendedDraft(id: string): boolean {
    const initialLength = this.suspendedDrafts.length;
    this.suspendedDrafts = this.suspendedDrafts.filter((d) => d.id !== id);
    const removed = this.suspendedDrafts.length < initialLength;
    if (removed) {
      this.notify();
    }
    return removed;
  }

  public resumeSuspendedDraft(id: string): ActiveToolDraft | null {
    const draftIndex = this.suspendedDrafts.findIndex((d) => d.id === id);
    if (draftIndex === -1) return null;

    const [resumed] = this.suspendedDrafts.splice(draftIndex, 1);
    resumed.isSuspended = false;
    this.activeDraft = resumed;
    this.notify();
    return resumed;
  }

  public clearSuspendedDrafts(): void {
    this.suspendedDrafts = [];
    this.notify();
  }
}

// -----------------------------------------------------------------------------
// Operation Creation Helpers
// -----------------------------------------------------------------------------

export function createEntityOperation(
  domain: SpatialDomain,
  entityId: string,
  entityRecord: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("create"),
    type: "create_entity",
    domain,
    entityId,
    before: null,
    after: entityRecord,
    description: description ?? `Create ${domain} entity ${entityId}`,
    timestamp: Date.now(),
  };
}

export function updateGeometryOperation(
  domain: SpatialDomain,
  entityId: string,
  beforeGeometry: Record<string, unknown>,
  afterGeometry: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("geom"),
    type: "update_geometry",
    domain,
    entityId,
    before: beforeGeometry,
    after: afterGeometry,
    description: description ?? `Update geometry for ${entityId}`,
    timestamp: Date.now(),
  };
}

export function updatePropertiesOperation(
  domain: SpatialDomain,
  entityId: string,
  beforeProperties: Record<string, unknown>,
  afterProperties: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("prop"),
    type: "update_properties",
    domain,
    entityId,
    before: beforeProperties,
    after: afterProperties,
    description: description ?? `Update properties for ${entityId}`,
    timestamp: Date.now(),
  };
}

export function retireEntityOperation(
  domain: SpatialDomain,
  entityId: string,
  currentRecord: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("retire"),
    type: "retire_entity",
    domain,
    entityId,
    before: currentRecord,
    after: { ...currentRecord, status: "retired" },
    description: description ?? `Retire entity ${entityId}`,
    timestamp: Date.now(),
  };
}

export function restoreEntityOperation(
  domain: SpatialDomain,
  entityId: string,
  retiredRecord: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("restore"),
    type: "restore_entity",
    domain,
    entityId,
    before: retiredRecord,
    after: { ...retiredRecord, status: "active" },
    description: description ?? `Restore entity ${entityId}`,
    timestamp: Date.now(),
  };
}

export function linkFeatureOperation(
  domain: SpatialDomain,
  entityId: string,
  linkRecord: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("link"),
    type: "link_feature",
    domain,
    entityId,
    before: null,
    after: linkRecord,
    description: description ?? `Link feature ${entityId}`,
    timestamp: Date.now(),
  };
}

export function unlinkFeatureOperation(
  domain: SpatialDomain,
  entityId: string,
  linkRecord: Record<string, unknown>,
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("unlink"),
    type: "unlink_feature",
    domain,
    entityId,
    before: linkRecord,
    after: null,
    description: description ?? `Unlink feature ${entityId}`,
    timestamp: Date.now(),
  };
}

export function compoundBatchOperation(
  domain: SpatialDomain,
  entityId: string,
  nestedOperations: WorkingOperation[],
  description?: string
): WorkingOperation {
  return {
    id: generateOperationId("compound"),
    type: "compound_batch",
    domain,
    entityId,
    before: null,
    after: null,
    nestedOperations: [...nestedOperations],
    description: description ?? `Compound batch with ${nestedOperations.length} operations`,
    timestamp: Date.now(),
  };
}

// -----------------------------------------------------------------------------
// Atomic Compound Undo/Redo Traversal Helpers
// -----------------------------------------------------------------------------

/**
 * Traverses an operation in reverse for undoing.
 * For compound_batch, walks nested operations in LIFO (reverse) order.
 */
export function traverseRevertOperation(
  operation: WorkingOperation,
  callback: (op: WorkingOperation) => void
): void {
  if (operation.type === "compound_batch" && operation.nestedOperations) {
    for (let i = operation.nestedOperations.length - 1; i >= 0; i--) {
      traverseRevertOperation(operation.nestedOperations[i], callback);
    }
  }
  callback(operation);
}

/**
 * Traverses an operation in forward order for redoing/applying.
 * For compound_batch, walks nested operations in forward order.
 */
export function traverseApplyOperation(
  operation: WorkingOperation,
  callback: (op: WorkingOperation) => void
): void {
  callback(operation);
  if (operation.type === "compound_batch" && operation.nestedOperations) {
    for (let i = 0; i < operation.nestedOperations.length; i++) {
      traverseApplyOperation(operation.nestedOperations[i], callback);
    }
  }
}

// -----------------------------------------------------------------------------
// Keyboard Helper & React Hooks
// -----------------------------------------------------------------------------

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

export interface KeyboardShortcutOptions {
  isBlocked?: () => boolean;
  onUndo?: (op: WorkingOperation | null) => void;
  onRedo?: (op: WorkingOperation | null) => void;
  allowInInputs?: boolean;
}

/**
 * Handles Ctrl+Z / Cmd+Z (Undo) and Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y (Redo).
 * Returns true if a shortcut was intercepted and executed.
 */
export function handleWorkingSessionKeyboardShortcut(
  event: KeyboardEvent | React.KeyboardEvent,
  manager: WorkingSessionManager,
  options?: KeyboardShortcutOptions
): boolean {
  if (!options?.allowInInputs && isEditableElement(event.target)) {
    return false;
  }

  if (options?.isBlocked && options.isBlocked()) {
    return false;
  }

  const isModifier = event.metaKey || event.ctrlKey;
  if (!isModifier || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();

  // Redo: Ctrl+Shift+Z, Cmd+Shift+Z, or Ctrl+Y, Cmd+Y
  if ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey)) {
    if (manager.canRedo()) {
      event.preventDefault();
      const op = manager.redo();
      options?.onRedo?.(op);
      return true;
    }
  }

  // Undo: Ctrl+Z or Cmd+Z (without shift)
  if (key === "z" && !event.shiftKey) {
    if (manager.canUndo()) {
      event.preventDefault();
      const op = manager.undo();
      options?.onUndo?.(op);
      return true;
    }
  }

  return false;
}

/**
 * React hook to bind a component to WorkingSessionManager state.
 */
export function useWorkingSession(manager: WorkingSessionManager): WorkingSessionState {
  return useSyncExternalStore(
    (onStoreChange) => manager.subscribe(onStoreChange),
    () => manager.getState()
  );
}

/**
 * React hook to listen for global undo/redo shortcuts on window.
 */
export function useWorkingSessionShortcuts(
  manager: WorkingSessionManager,
  options?: KeyboardShortcutOptions & { enabled?: boolean }
): void {
  const { enabled = true, ...shortcutOpts } = options ?? {};

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      handleWorkingSessionKeyboardShortcut(event, manager, shortcutOpts);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [manager, enabled, shortcutOpts]);
}
