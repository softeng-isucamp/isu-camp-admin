import { describe, expect, it } from "vitest";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { createWorkingSessionJournal, type WorkingSessionStorage } from "./WorkingSessionJournal";

const createMemoryStorage = (): WorkingSessionStorage => {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
};

describe("WorkingSessionJournal", () => {
  it("round-trips a Working Session by administrator and project", () => {
    const storage = createMemoryStorage();
    const journal = createWorkingSessionJournal(storage);
    const manager = new WorkingSessionManager();
    manager.startDraft({
      toolType: "point",
      label: "Route Node draft",
      provisionalGeometry: { points: [{ x: 121.7, y: 16.9 }] },
    });
    const key = { administratorId: "admin-1", projectId: "echague" };
    const stored = {
      schemaVersion: 1 as const,
      snapshot: manager.exportSnapshot(),
    };

    journal.save(key, stored);

    expect(journal.load(key)).toEqual(stored);
    expect(journal.load({ administratorId: "admin-2", projectId: "echague" })).toBeNull();
    expect(journal.load({ administratorId: "admin-1", projectId: "cauayan" })).toBeNull();
  });

  it("clears only the selected administrator and project", () => {
    const storage = createMemoryStorage();
    const journal = createWorkingSessionJournal(storage);
    const manager = new WorkingSessionManager();
    const first = { administratorId: "admin-1", projectId: "echague" };
    const second = { administratorId: "admin-2", projectId: "echague" };
    const stored = {
      schemaVersion: 1 as const,
      snapshot: manager.exportSnapshot(),
    };
    journal.save(first, stored);
    journal.save(second, stored);

    journal.clear(first);

    expect(journal.load(first)).toBeNull();
    expect(journal.load(second)).toEqual(stored);
  });

  it("ignores malformed stored data", () => {
    const storage = createMemoryStorage();
    storage.setItem("isu-map-editor-working-session:v1:admin-1:echague", "not-json");
    const journal = createWorkingSessionJournal(storage);

    expect(journal.load({ administratorId: "admin-1", projectId: "echague" })).toBeNull();
  });

  it("ignores stored data without a valid Working Session checkpoint", () => {
    const storage = createMemoryStorage();
    storage.setItem("isu-map-editor-working-session:v1:admin-1:echague", JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        schemaVersion: 1,
        pastOperations: [],
        activeDraft: null,
        suspendedDrafts: [],
        savedCheckpointIndex: "invalid",
      },
    }));
    const journal = createWorkingSessionJournal(storage);

    expect(journal.load({ administratorId: "admin-1", projectId: "echague" })).toBeNull();
  });

  it("ignores a malformed active Tool Draft before UI recovery", () => {
    const storage = createMemoryStorage();
    storage.setItem("isu-map-editor-working-session:v1:admin-1:echague", JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        schemaVersion: 1,
        pastOperations: [],
        activeDraft: {},
        suspendedDrafts: [],
        savedCheckpointIndex: 0,
      },
    }));
    const journal = createWorkingSessionJournal(storage);

    expect(journal.load({ administratorId: "admin-1", projectId: "echague" })).toBeNull();
  });

  it("silently drops removed operation types and drafts of removed tools", () => {
    const storage = createMemoryStorage();
    const journal = createWorkingSessionJournal(storage);
    const key = { administratorId: "admin-1", projectId: "echague" };
    const kept = { id: "op-1", type: "update_geometry", domain: "Locations", entityId: "b1", before: null, after: null };
    const removedType = { id: "op-2", type: "retired_op_type", domain: "Locations", entityId: "x", before: null, after: null };
    const removedNested = {
      id: "op-3", type: "compound_batch", domain: "Locations", entityId: "b2", before: null, after: null,
      nestedOperations: [kept, removedType],
    };
    const polygonDraft = { id: "d1", toolType: "polygon", provisionalGeometry: {}, isSuspended: true };
    const localFeatureDraft = { id: "d2", toolType: "local_feature", provisionalGeometry: {}, isSuspended: true };
    storage.setItem("isu-map-editor-working-session:v1:admin-1:echague", JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        schemaVersion: 1,
        pastOperations: [removedType, kept, removedNested],
        activeDraft: localFeatureDraft,
        suspendedDrafts: [localFeatureDraft, polygonDraft],
        savedCheckpointIndex: 2,
      },
    }));

    const stored = journal.load(key);

    expect(stored?.snapshot.pastOperations).toEqual([kept]);
    expect(stored?.snapshot.savedCheckpointIndex).toBe(1);
    expect(stored?.snapshot.activeDraft).toBeNull();
    expect(stored?.snapshot.suspendedDrafts).toEqual([polygonDraft]);
    new WorkingSessionManager().hydrate(stored!.snapshot);
  });
});
