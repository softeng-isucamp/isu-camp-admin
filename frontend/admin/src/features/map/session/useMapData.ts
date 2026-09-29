import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { services } from "../../../services/api";
import { normalizeMapLayers } from "../../../services/mapLayers";
import { echagueCampusBoundary } from "../campusBoundary";

/**
 * The directory data the Map Editor loads: the map records and the full
 * Locations directory, plus the campus boundary and normalized layers derived
 * from them. Session changes are layered on top by `useSessionMapData`.
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
  const directoryBuildings = (data?.buildings || []).filter((building) => building.points.length >= 3);
  // Local map features are retained by the data/service layer for compatibility,
  // but are intentionally not rendered in this editor. The campus boundary is
  // still used below for validation and navigation bounds.
  const campusBoundary = useMemo(
    () => directoryBuildings.find((building) => building.code === "CAMPUS_00" || /whole isu campus/i.test(building.name))?.points ?? echagueCampusBoundary,
    [directoryBuildings],
  );
  const directoryMapLayers = useMemo(() => normalizeMapLayers({
    buildings: data?.buildings || [],
    locations: data?.locations || [],
    routeNodes: data?.nodes || [],
    pathways: data?.pathways || [],
  }), [data?.buildings, data?.locations, data?.nodes, data?.pathways]);

  return {
    data,
    locationDirectory,
    directoryLocations,
    directoryNodes,
    directoryPathways,
    campusBoundary,
    directoryMapLayers,
  };
}
