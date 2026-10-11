import type { QueryClient } from "@tanstack/react-query";

export type MapLoadStageKey = "buildings" | "locations" | "nodes" | "pathways" | "directory";

export interface MapLoadStage {
  key: MapLoadStageKey;
  label: string;
  status: "pending" | "loading" | "done" | "error";
  /** Progress text for a stage in flight, e.g. "3 of 7 pages". */
  detail?: string;
}

/** The map records are fetched in this order, then the Locations directory runs beside them. */
const MAP_RECORD_STAGES: { key: MapLoadStageKey; label: string }[] = [
  { key: "buildings", label: "Buildings" },
  { key: "locations", label: "Locations on map" },
  { key: "nodes", label: "Route Nodes" },
  { key: "pathways", label: "Pathways" },
];
const DIRECTORY_STAGE = { key: "directory" as const, label: "Locations directory" };

/** What the fetches report from inside their query functions. */
export interface MapLoadProgress {
  /** How many of the map records have arrived in the current fetch. */
  mapStagesDone: number;
  /** Page progress of the Locations directory fetch. */
  directoryDetail: string | undefined;
}

export interface MapLoadProgressStore {
  getSnapshot: () => MapLoadProgress;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<MapLoadProgress>) => void;
}

const createStore = (): MapLoadProgressStore => {
  let snapshot: MapLoadProgress = { mapStagesDone: 0, directoryDetail: undefined };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (patch) => {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
};

const stores = new WeakMap<QueryClient, MapLoadProgressStore>();

/**
 * The progress of the Map Editor's fetches. A query keeps running when the editor
 * unmounts, so progress belongs to the query client (like the query itself) rather
 * than to one mounted editor.
 */
export function mapLoadProgressFor(client: QueryClient): MapLoadProgressStore {
  let store = stores.get(client);
  if (!store) {
    store = createStore();
    stores.set(client, store);
  }
  return store;
}

/** The slice of one query's state that the load display depends on. */
export interface QueryLoadState {
  hasData: boolean;
  fetching: boolean;
  /** Set only when the query failed after its retries and has no data to show. */
  error: string | null;
  /** A failed attempt is being retried. */
  retrying: boolean;
}

export interface MapLoad {
  stages: MapLoadStage[];
  /** Fraction of stages done, 0..1. */
  progress: number;
  loaded: boolean;
  error: string | null;
}

/** What the editor gets from `useMapData`: the load plus re-running whatever failed. */
export interface MapLoadState extends MapLoad {
  retry: () => void;
}

/** Turns the two queries and the fetch progress into the stages the loading display shows. */
export function deriveMapLoad({ map, directory, progress }: {
  map: QueryLoadState;
  directory: QueryLoadState;
  progress: MapLoadProgress;
}): MapLoad {
  const stages: MapLoadStage[] = [
    ...MAP_RECORD_STAGES.map(({ key, label }, index): MapLoadStage => {
      if (map.hasData || index < progress.mapStagesDone) return { key, label, status: "done" };
      if (index > progress.mapStagesDone) return { key, label, status: "pending" };
      if (map.error) return { key, label, status: "error" };
      if (map.fetching) return { key, label, status: "loading", detail: map.retrying ? "Retrying" : undefined };
      return { key, label, status: "pending" };
    }),
    ((): MapLoadStage => {
      const { key, label } = DIRECTORY_STAGE;
      if (directory.hasData) return { key, label, status: "done" };
      if (directory.error) return { key, label, status: "error" };
      if (directory.fetching) {
        return { key, label, status: "loading", detail: progress.directoryDetail ?? (directory.retrying ? "Retrying" : undefined) };
      }
      return { key, label, status: "pending" };
    })(),
  ];
  return {
    stages,
    progress: stages.filter((stage) => stage.status === "done").length / stages.length,
    loaded: map.hasData && directory.hasData,
    error: map.error ?? directory.error,
  };
}
