import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { deriveMapLoad, mapLoadProgressFor, type QueryLoadState } from "./mapLoadProgress";

const idle: QueryLoadState = { hasData: false, fetching: false, error: null, retrying: false };
const fetching: QueryLoadState = { ...idle, fetching: true };
const loaded: QueryLoadState = { ...idle, hasData: true };
const none = { mapStagesDone: 0, directoryDetail: undefined };

const statuses = (load: ReturnType<typeof deriveMapLoad>) => load.stages.map((stage) => stage.status);

describe("deriveMapLoad", () => {
  it("marks the map record being fetched as loading and later ones as pending", () => {
    const load = deriveMapLoad({ map: fetching, directory: fetching, progress: { mapStagesDone: 2, directoryDetail: "1 of 3 pages" } });

    expect(load.stages.map((stage) => stage.key)).toEqual(["buildings", "locations", "nodes", "pathways", "directory"]);
    expect(statuses(load)).toEqual(["done", "done", "loading", "pending", "loading"]);
    expect(load.stages[4].detail).toBe("1 of 3 pages");
    expect(load.progress).toBeCloseTo(2 / 5);
    expect(load.loaded).toBe(false);
    expect(load.error).toBeNull();
  });

  it("treats cached data as done without any fetch progress", () => {
    const load = deriveMapLoad({ map: loaded, directory: loaded, progress: none });

    expect(statuses(load)).toEqual(["done", "done", "done", "done", "done"]);
    expect(load.progress).toBe(1);
    expect(load.loaded).toBe(true);
  });

  it("is not loaded until both queries have data", () => {
    const load = deriveMapLoad({ map: loaded, directory: fetching, progress: none });

    expect(statuses(load)).toEqual(["done", "done", "done", "done", "loading"]);
    expect(load.progress).toBeCloseTo(4 / 5);
    expect(load.loaded).toBe(false);
  });

  it("reports the failed map record and keeps earlier ones done", () => {
    const load = deriveMapLoad({
      map: { ...idle, error: "Pathways could not be loaded." },
      directory: fetching,
      progress: { mapStagesDone: 3, directoryDetail: undefined },
    });

    expect(statuses(load)).toEqual(["done", "done", "done", "error", "loading"]);
    expect(load.error).toBe("Pathways could not be loaded.");
    expect(load.loaded).toBe(false);
  });

  it("reports a failed directory", () => {
    const load = deriveMapLoad({ map: loaded, directory: { ...idle, error: "Directory unavailable." }, progress: none });

    expect(statuses(load)).toEqual(["done", "done", "done", "done", "error"]);
    expect(load.error).toBe("Directory unavailable.");
  });

  it("notes a retry on the stage in flight", () => {
    const load = deriveMapLoad({
      map: { ...fetching, retrying: true },
      directory: loaded,
      progress: { mapStagesDone: 1, directoryDetail: undefined },
    });

    expect(load.stages[1]).toMatchObject({ status: "loading", detail: "Retrying" });
  });
});

describe("mapLoadProgressFor", () => {
  it("is shared by every user of one query client and separate between clients", () => {
    const client = new QueryClient();
    expect(mapLoadProgressFor(client)).toBe(mapLoadProgressFor(client));
    expect(mapLoadProgressFor(new QueryClient())).not.toBe(mapLoadProgressFor(client));
  });

  it("notifies subscribers with a new snapshot on each update and stops after unsubscribe", () => {
    const store = mapLoadProgressFor(new QueryClient());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const initial = store.getSnapshot();

    store.update({ mapStagesDone: 2 });
    expect(store.getSnapshot()).not.toBe(initial);
    expect(store.getSnapshot()).toEqual({ mapStagesDone: 2, directoryDetail: undefined });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.update({ directoryDetail: "2 of 3 pages" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
