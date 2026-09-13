import type { WorkingSessionSnapshot } from "./types";
import type { ActiveToolDraft } from "./types";

export interface WorkingSessionKey {
  administratorId: string;
  projectId: string;
}

export interface StoredWorkingSession {
  schemaVersion: 1;
  adminDraftVersion: number | null;
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

const isActiveToolDraft = (value: unknown): value is ActiveToolDraft => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActiveToolDraft>;
  return typeof candidate.id === "string"
    && ["point", "polygon", "pathway", "local_feature"].includes(candidate.toolType ?? "")
    && Boolean(candidate.provisionalGeometry)
    && typeof candidate.provisionalGeometry === "object"
    && typeof candidate.isSuspended === "boolean";
};

const isStoredWorkingSession = (value: unknown): value is StoredWorkingSession => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredWorkingSession>;
  return candidate.schemaVersion === 1
    && (candidate.adminDraftVersion === null || typeof candidate.adminDraftVersion === "number")
    && candidate.snapshot?.schemaVersion === 1
    && Array.isArray(candidate.snapshot.pastOperations)
    && Array.isArray(candidate.snapshot.futureOperations)
    && Array.isArray(candidate.snapshot.suspendedDrafts)
    && candidate.snapshot.suspendedDrafts.every(isActiveToolDraft)
    && Number.isInteger(candidate.snapshot.savedCheckpointIndex)
    && (candidate.snapshot.activeDraft === null || isActiveToolDraft(candidate.snapshot.activeDraft));
};

export function createWorkingSessionJournal(storage: WorkingSessionStorage): WorkingSessionJournal {
  return {
    load(key) {
      const raw = storage.getItem(storageKey(key));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isStoredWorkingSession(parsed) ? parsed : null;
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
