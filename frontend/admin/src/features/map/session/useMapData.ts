import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { services } from "../../../services/api";
import { echagueCampusBoundary } from "../campusBoundary";
import { deriveMapLoad, mapLoadProgressFor, type MapLoadState, type QueryLoadState } from "./mapLoadProgress";

const queryLoadState = (query: UseQueryResult<unknown>): QueryLoadState => ({
  hasData: query.data !== undefined,
  fetching: query.isFetching,
  // A refetch that fails keeps the data on screen; only a load with nothing to show is an error.
  error: query.isError && query.data === undefined
    ? (query.error instanceof Error ? query.error.message : "The Map Editor data could not be loaded.")
    : null,
  retrying: query.isFetching && query.failureCount > 0,
});

/**
 * The directory data the Map Editor loads: the map records and the full
 * Locations directory, plus the campus boundary and how far loading has got.
 * Session changes are layered on top by `useSessionMapData`.
 */
export function useMapData() {
  const queryClient = useQueryClient();
  const loadProgress = mapLoadProgressFor(queryClient);
  const mapQuery = useQuery({
    queryKey: ["map"],
    queryFn: async () => {
      loadProgress.update({ mapStagesDone: 0 });
      const buildings = await services.map.buildings();
      loadProgress.update({ mapStagesDone: 1 });
      const locations = await services.map.locations();
      loadProgress.update({ mapStagesDone: 2 });
      const nodes = await services.map.nodes();
      loadProgress.update({ mapStagesDone: 3 });
      const pathways = await services.map.pathways();
      loadProgress.update({ mapStagesDone: 4 });
      return { buildings, locations, nodes, pathways };
    },
  });
  const directoryQuery = useQuery({
    queryKey: ["locations", "map-directory"],
    queryFn: async () => {
      loadProgress.update({ directoryDetail: undefined });
      const first = await services.locations.list("", 1, 100);
      const pages = Math.ceil(first.total / first.pageSize);
      let fetched = 1;
      loadProgress.update({ directoryDetail: `${fetched} of ${pages} pages` });
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, async (_, index) => {
          const page = await services.locations.list("", index + 2, first.pageSize);
          fetched += 1;
          loadProgress.update({ directoryDetail: `${fetched} of ${pages} pages` });
          return page;
        }),
      );
      return [first, ...remaining].flatMap((page) => page.items);
    },
    retry: false,
  });
  const { data } = mapQuery;
  const { data: locationDirectory } = directoryQuery;

  const progress = useSyncExternalStore(loadProgress.subscribe, loadProgress.getSnapshot);
  const mapState = queryLoadState(mapQuery);
  const directoryState = queryLoadState(directoryQuery);
  const derivedLoad = deriveMapLoad({ map: mapState, directory: directoryState, progress });
  const { refetch: refetchMap } = mapQuery;
  const { refetch: refetchDirectory } = directoryQuery;
  // Retry re-runs only the query that failed.
  const retry = useCallback(() => {
    if (mapState.error) void refetchMap();
    if (directoryState.error) void refetchDirectory();
  }, [mapState.error, directoryState.error, refetchMap, refetchDirectory]);

  const load: MapLoadState = { ...derivedLoad, retry };

  const directoryLocations = data?.locations || [];
  const directoryNodes = data?.nodes || [];
  const directoryPathways = data?.pathways || [];
  // The campus boundary is used below for validation and navigation bounds.
  const campusBoundary = echagueCampusBoundary;

  return {
    data,
    locationDirectory,
    directoryLocations,
    directoryNodes,
    directoryPathways,
    campusBoundary,
    load,
  };
}
