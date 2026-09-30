import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { isIndoorLocation } from "../indoorLocation/indoorLocations";
import type { useMapData } from "./useMapData";

/** What a URL intent asked the Map Editor to do; MapEditor applies the mode, selection, and framing. */
export type MapRouteIntent =
  | { type: "open-building-tool" }
  | { type: "locate-indoor-location"; location: Location; parentBuilding: Building; place: boolean }
  | { type: "locate-building"; building: Building }
  | { type: "locate-location"; location: Location }
  | { type: "open-pathway"; pathway: Pathway; sourceNode: RouteNode | undefined };

interface UseMapRouteIntentsOptions {
  route: { pathname: string; search: string; navigate: NavigateFunction };
  data: {
    /** The loaded map data; intents wait for it, and each URL intent clears its param once handled so a refetch does not re-run it. */
    map: ReturnType<typeof useMapData>["data"];
    directoryLocations: Location[];
    directoryPathways: Pathway[];
    overlayPathways: Pathway[];
  };
  current: { buildings: Building[]; locations: Location[]; nodes: RouteNode[] };
  onIntent: (intent: MapRouteIntent) => void;
  setError: (message: string) => void;
}

/**
 * Reads the Map Editor's URL intents once their data is available: opening
 * the Building tool (`create`), locating or placing an indoor Location,
 * locating a Building or Location, and opening a Pathway for editing. It
 * reports each resolved intent through `onIntent` and never changes the editor
 * mode or selection itself.
 */
export function useMapRouteIntents({ route, data, current, onIntent, setError }: UseMapRouteIntentsOptions) {
  useEffect(() => {
    const create = new URLSearchParams(route.search).get("create");
    if (create === "building") {
      onIntent({ type: "open-building-tool" });
      return;
    }
  }, [route.search]);

  useEffect(() => {
    const indoorLocationId = new URLSearchParams(route.search).get("indoorLocation");
    if (indoorLocationId) {
      if (!data.map) return;
      const indoorLocation = current.locations.find((item) => item.id === indoorLocationId && isIndoorLocation(item));
      const parentBuilding = indoorLocation
        ? current.buildings.find((item) => item.id === indoorLocation.parentId || item.name === indoorLocation.building)
        : undefined;
      if (!indoorLocation || !parentBuilding) {
        setError("The indoor location or its parent Building could not be found.");
        route.navigate(route.pathname, { replace: true });
        return;
      }
      const place = new URLSearchParams(route.search).get("place") === "1";
      onIntent({ type: "locate-indoor-location", location: indoorLocation, parentBuilding, place });
      route.navigate(route.pathname, { replace: true });
      return;
    }

    const locationId = new URLSearchParams(route.search).get(
      "location",
    );
    const building = locationId ? current.buildings.find((item) => item.id === locationId) : undefined;
    const loc = locationId ? data.directoryLocations.find((item) => item.id === locationId) : undefined;
    if (locationId && (building || loc)) {
      if (building) onIntent({ type: "locate-building", building });
      else if (loc) onIntent({ type: "locate-location", location: loc });
      route.navigate(route.pathname, { replace: true });
    }
  }, [current.locations, current.buildings, data.map, data.directoryLocations, route.navigate, route.pathname, route.search]);

  useEffect(() => {
    const pathwayId = new URLSearchParams(route.search).get("pathway");
    if (!pathwayId) return;
    if (!data.map) return;
    const requested = data.overlayPathways.find((item) => item.id === pathwayId)
      ?? data.directoryPathways.find((item) => item.id === pathwayId);
    if (!requested) {
      setError("The requested Pathway is no longer available. Refresh the Walking Network and try again.");
      route.navigate(route.pathname, { replace: true });
      return;
    }
    const sourceNode = current.nodes.find((node) => node.id === requested.sourceNodeId);
    onIntent({ type: "open-pathway", pathway: requested, sourceNode });
    route.navigate(route.pathname, { replace: true });
  }, [current.nodes, data.map, data.directoryPathways, data.overlayPathways, route.navigate, route.pathname, route.search]);
}
