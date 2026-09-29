import { useQuery } from "@tanstack/react-query";
import { services } from "../../../services/api";
import { echagueCampusBoundary } from "../campusBoundary";

/**
 * The directory data the Map Editor loads: the map records and the full
 * Locations directory, plus the campus boundary. Session changes are layered
 * on top by `useSessionMapData`.
 */
export function useMapData() {
  const { data } = useQuery({
    queryKey: ["map"],
    queryFn: async () => ({
      buildings: await services.map.buildings(),
      locations: await services.map.locations(),
      nodes: await services.map.nodes(),
      pathways: await services.map.pathways(),
    }),
  });
  const { data: locationDirectory } = useQuery({
    queryKey: ["locations", "map-directory"],
    queryFn: async () => {
      const first = await services.locations.list("", 1, 100);
      const pages = Math.ceil(first.total / first.pageSize);
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
          services.locations.list("", index + 2, first.pageSize)),
      );
      return [first, ...remaining].flatMap((page) => page.items);
    },
    retry: false,
  });

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
  };
}
