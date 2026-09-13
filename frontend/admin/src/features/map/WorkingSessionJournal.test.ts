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
      adminDraftVersion: 4,
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
      adminDraftVersion: null,
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
      adminDraftVersion: 1,
      snapshot: {
        schemaVersion: 1,
        pastOperations: [],
        futureOperations: [],
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
      adminDraftVersion: 1,
      snapshot: {
        schemaVersion: 1,
        pastOperations: [],
        futureOperations: [],
        activeDraft: {},
        suspendedDrafts: [],
        savedCheckpointIndex: 0,
      },
    }));
    const journal = createWorkingSessionJournal(storage);

    expect(journal.load({ administratorId: "admin-1", projectId: "echague" })).toBeNull();
  });
});
