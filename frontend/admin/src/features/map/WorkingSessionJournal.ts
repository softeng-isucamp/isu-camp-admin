import type {
  ActiveToolDraft,
  SpatialDomain,
  WorkingOperation,
  WorkingOperationType,
  WorkingSessionSnapshot,
} from "./types";

export interface WorkingSessionKey {
  administratorId: string;
  projectId: string;
}

export interface StoredWorkingSession {
  schemaVersion: 1;
  snapshot: WorkingSessionSnapshot;
}

export interface WorkingSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkingSessionJournal {
  load(key: WorkingSessionKey): StoredWorkingSession | null;
  save(key: WorkingSessionKey, session: StoredWorkingSession): void;
  clear(key: WorkingSessionKey): void;
}

const storageKey = ({ administratorId, projectId }: WorkingSessionKey) =>
  `isu-map-editor-working-session:v1:${encodeURIComponent(administratorId)}:${encodeURIComponent(projectId)}`;

const TOOL_TYPES: readonly ActiveToolDraft["toolType"][] = ["point", "polygon", "pathway"];

/** A draft with the right shape, whatever tool it belongs to. */
const isDraftShaped = (value: unknown): value is ActiveToolDraft => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActiveToolDraft>;
  return typeof candidate.id === "string"
    && typeof candidate.toolType === "string"
    && Boolean(candidate.provisionalGeometry)
    && typeof candidate.provisionalGeometry === "object"
    && typeof candidate.isSuspended === "boolean";
};

const isRestorableDraft = (value: ActiveToolDraft) => TOOL_TYPES.includes(value.toolType);

const OPERATION_TYPES: readonly WorkingOperationType[] = [
  "create_entity",
  "update_geometry",
  "update_properties",
  "retire_entity",
  "restore_entity",
  "link_feature",
  "unlink_feature",
  "compound_batch",
];
const SPATIAL_DOMAINS: readonly SpatialDomain[] = ["Locations", "Walking Network", "Local Map Data"];

const isKnownOperation = (value: unknown): value is WorkingOperation => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkingOperation>;
  return typeof candidate.id === "string"
    && typeof candidate.entityId === "string"
    && OPERATION_TYPES.includes(candidate.type as WorkingOperationType)
    && SPATIAL_DOMAINS.includes(candidate.domain as SpatialDomain);
};

/** Keeps a recorded operation only if it, and everything nested in it, is still understood. */
const isRestorableOperation = (value: unknown): boolean =>
  isKnownOperation(value)
  && (value.nestedOperations === undefined
    || (Array.isArray(value.nestedOperations) && value.nestedOperations.every(isRestorableOperation)));

const isStoredWorkingSession = (value: unknown): value is StoredWorkingSession => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredWorkingSession>;
  return candidate.schemaVersion === 1
    && candidate.snapshot?.schemaVersion === 1
    && Array.isArray(candidate.snapshot.pastOperations)
    && Array.isArray(candidate.snapshot.suspendedDrafts)
    && candidate.snapshot.suspendedDrafts.every(isDraftShaped)
    && Number.isInteger(candidate.snapshot.savedCheckpointIndex)
    && (candidate.snapshot.activeDraft === null || isDraftShaped(candidate.snapshot.activeDraft));
};

/**
 * Drops journal entries this editor no longer understands (removed operation
 * types or domains, drafts of removed tools) without a message or migration.
 */
const dropUnrestorableEntries = (session: StoredWorkingSession): StoredWorkingSession => {
  const { snapshot } = session;
  const pastOperations: WorkingOperation[] = [];
  let savedCheckpointIndex = snapshot.savedCheckpointIndex;
  snapshot.pastOperations.forEach((operation, index) => {
    if (isRestorableOperation(operation)) pastOperations.push(operation);
    else if (index < snapshot.savedCheckpointIndex) savedCheckpointIndex -= 1;
  });
  return {
    schemaVersion: 1,
    snapshot: {
      schemaVersion: 1,
      pastOperations,
      activeDraft: snapshot.activeDraft && isRestorableDraft(snapshot.activeDraft) ? snapshot.activeDraft : null,
      suspendedDrafts: snapshot.suspendedDrafts.filter(isRestorableDraft),
      savedCheckpointIndex: Math.max(0, savedCheckpointIndex),
    },
  };
};

export function createWorkingSessionJournal(storage: WorkingSessionStorage): WorkingSessionJournal {
  return {
    load(key) {
      const raw = storage.getItem(storageKey(key));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isStoredWorkingSession(parsed) ? dropUnrestorableEntries(parsed) : null;
      } catch {
        return null;
      }
    },
    save(key, session) {
      storage.setItem(storageKey(key), JSON.stringify(session));
    },
    clear(key) {
      storage.removeItem(storageKey(key));
    },
  };
}
