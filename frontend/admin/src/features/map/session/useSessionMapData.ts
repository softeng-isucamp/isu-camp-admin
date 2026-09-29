import { useMemo } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { locationIdentityKey } from "../../../lib/locationPolicy";
import { overlayChanges } from "../mapEditing";
import type { MapOverlay } from "./useMapOverlay";

interface SessionMapDataSource {
  buildings: Building[];
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
}

/**
 * The directory data with this session's overlay changes applied: current
 * Locations and Route Nodes, Building content Locations, and the Building
 * lists used for the Network Browser and Location association pickers.
 */
export function useSessionMapData(
  data: SessionMapDataSource | undefined,
  locationDirectory: Location[] | undefined,
  overlay: MapOverlay,
) {
  const directoryLocations = data?.locations || [];
  const directoryNodes = data?.nodes || [];
  const currentLocations = useMemo(() => overlayChanges(directoryLocations, overlay.locations), [directoryLocations, overlay.locations]);
  const buildingContentLocations = useMemo(() => {
    const locationsById = new Map((locationDirectory ?? []).map((location) => [locationIdentityKey(location), location]));
    for (const location of currentLocations) locationsById.set(locationIdentityKey(location), location);
    return Array.from(locationsById.values());
  }, [currentLocations, locationDirectory]);
  const currentNodes = useMemo(() => overlayChanges(directoryNodes, overlay.nodes), [directoryNodes, overlay.nodes]);
  const sessionBuildings = useMemo(() => {
    return overlayChanges(data?.buildings || [], overlay.buildings);
  }, [data?.buildings, overlay.buildings]);
  const allSessionBuildings = useMemo(() => {
    const buildingMap = new Map<string, Building>();
    for (const loc of currentLocations) {
      if (loc.type === "Building" || loc.type === "Facility") {
        buildingMap.set(loc.id, {
          id: loc.id,
          name: loc.name,
          code: loc.code,
          type: loc.type === "Facility" ? "Facility" : "Building",
          status: loc.status ?? "Active",
          points: [],
        });
      }
    }
    for (const bld of sessionBuildings) {
      const existing = buildingMap.get(bld.id);
      buildingMap.set(bld.id, {
        ...existing,
        ...bld,
      });
    }
    return Array.from(buildingMap.values());
  }, [currentLocations, sessionBuildings]);
  const buildingAssociationOptions = useMemo(() => {
    const buildingMap = new Map<string, Building>();
    for (const location of locationDirectory ?? []) {
      if (location.type !== "Building") continue;
      buildingMap.set(location.id, {
        id: location.id,
        name: location.name,
        code: location.code,
        type: "Building",
        status: location.status,
        points: [],
      });
    }
    for (const building of allSessionBuildings) {
      if (building.type === "Facility") continue;
      const existing = buildingMap.get(building.id);
      buildingMap.set(building.id, { ...existing, ...building, type: "Building" });
    }
    return Array.from(buildingMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [allSessionBuildings, locationDirectory]);

  return {
    currentLocations,
    buildingContentLocations,
    currentNodes,
    sessionBuildings,
    allSessionBuildings,
    buildingAssociationOptions,
  };
}
