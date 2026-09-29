import { useMemo } from "react";
import type L from "leaflet";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { isIndoorLocation, isPositionedLocation } from "../indoorLocation/indoorLocations";
import { isPointInBounds } from "../mapEditing";
import type { MapSelection } from "./useMapSelection";

export interface CurrentMapObjects {
  buildings: Building[];
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
}

/**
 * Mode-driven dynamic filtering and viewport culling for fast, lag-free
 * rendering. The selected object is always kept rendered.
 */
export function useVisibleMapObjects(
  current: CurrentMapObjects,
  mode: "select" | "place" | "path" | "area" | "move",
  selected: MapSelection | null,
  mapBounds: L.LatLngBounds | null,
) {
  const { buildings, locations, nodes, pathways } = current;

  const visibleLocations = useMemo(() => {
    const positioned = locations.filter(isPositionedLocation);
    if (mode === "area") return [];
    return positioned.filter(
      (loc) => !isIndoorLocation(loc)
        && loc.type !== "Building"
        && (loc.type !== "Facility" || !buildings.some((building) => building.id === loc.id))
        && (isPointInBounds(loc.lat, loc.lng, mapBounds) || (selected?.type === "location" && selected.id === loc.id))
    );
  }, [buildings, locations, mapBounds, mode, selected?.id, selected?.type]);

  const visibleNodes = useMemo(() => {
    if (mode === "place" || mode === "area") return [];
    return nodes.filter(
      (node) => isPointInBounds(node.lat, node.lng, mapBounds)
        || (selected?.type === "node" && selected.id === node.id)
    );
  }, [mapBounds, nodes, mode, selected?.id, selected?.type]);

  const visiblePathways = useMemo(() => {
    if (mode === "area") return [];
    return pathways;
  }, [pathways, mode]);

  return { buildings, locations: visibleLocations, nodes: visibleNodes, pathways: visiblePathways };
}
