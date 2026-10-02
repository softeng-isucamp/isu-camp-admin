import type {
  ActiveToolDraft,
  InterruptionAction,
  SpatialDomain,
  WorkingOperation,
  WorkingSessionSnapshot,
  WorkingSessionState,
} from "./types";

let operationIdCounter = 0;
function generateOperationId(prefix = "op"): string {
  operationIdCounter += 1;
  return `${prefix}-${Date.now()}-${operationIdCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Pure state container for the Working Session operation log, dirtiness
 * tracking, the tool draft lifecycle, and 3-way interruption draft safety.
 */
export class WorkingSessionManager {
  private pastOperations: WorkingOperation[] = [];
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
      activeDraft: this.activeDraft ? { ...this.activeDraft } : null,
      suspendedDrafts: this.suspendedDrafts.map((d) => ({ ...d })),
      isDirty: this.getIsDirty(),
      uncommittedCount: this.getUncommittedCount(),
    };
  }

  public exportSnapshot(): WorkingSessionSnapshot {
    return structuredClone({
      schemaVersion: 1 as const,
      pastOperations: this.pastOperations,
      activeDraft: this.activeDraft,
      suspendedDrafts: this.suspendedDrafts,
      savedCheckpointIndex: this.savedCheckpointIndex,
    });
  }

  public hydrate(snapshot: WorkingSessionSnapshot): void {
    if (
      snapshot.schemaVersion !== 1
      || !Array.isArray(snapshot.pastOperations)
      || !Array.isArray(snapshot.suspendedDrafts)
      || !Number.isInteger(snapshot.savedCheckpointIndex)
    ) {
      throw new Error("Working Session snapshot is invalid.");
    }

    this.pastOperations = structuredClone(snapshot.pastOperations);
    this.activeDraft = snapshot.activeDraft ? structuredClone(snapshot.activeDraft) : null;
    this.suspendedDrafts = structuredClone(snapshot.suspendedDrafts);
    this.savedCheckpointIndex = Math.max(
      0,
      Math.min(snapshot.savedCheckpointIndex, this.pastOperations.length),
    );
    this.notify();
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
  // Operation Log
  // ---------------------------------------------------------------------------

  public executeOperation(
    operation: Omit<WorkingOperation, "id"> & { id?: string }
  ): WorkingOperation {
    const op: WorkingOperation = {
      ...operation,
      id: operation.id ?? generateOperationId("op"),
      timestamp: operation.timestamp ?? Date.now(),
    };

    if (this.pastOperations.length < this.savedCheckpointIndex) {
      this.savedCheckpointIndex = this.pastOperations.length;
    }
    this.pastOperations.push(op);
    this.notify();
    return op;
  }

  public getPastOperations(): readonly WorkingOperation[] {
    return this.pastOperations;
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
