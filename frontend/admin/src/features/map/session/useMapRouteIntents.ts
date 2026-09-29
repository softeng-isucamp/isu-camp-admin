import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { useIndoorLocationPlacement } from "../indoorLocation/useIndoorLocationPlacement";
import { isIndoorLocation, isPositionedLocation } from "../indoorLocation/indoorLocations";
import { polygonFeatureAnchor } from "../mapEditing";
import type { usePathwayEditing } from "../pathway/usePathwayEditing";
import type { MapSelection } from "../selection/useMapSelection";
import type { EditorMode } from "../types";
import type { useToolSession } from "./useToolSession";

interface UseMapRouteIntentsOptions {
  route: { pathname: string; search: string; navigate: NavigateFunction };
  data: {
    loaded: boolean;
    directoryLocations: Location[];
    directoryPathways: Pathway[];
    overlayPathways: Pathway[];
  };
  current: { buildings: Building[]; locations: Location[]; nodes: RouteNode[] };
  indoor: ReturnType<typeof useIndoorLocationPlacement>;
  pathway: ReturnType<typeof usePathwayEditing>;
  toolSession: ReturnType<typeof useToolSession>;
  view: {
    setMode: (mode: EditorMode) => void;
    setSelected: (selection: MapSelection | null) => void;
    setError: (message: string) => void;
    setFrameBounds: (bounds: [[number, number], [number, number]] | null) => void;
    flyTo: (point: [number, number], zoom?: number) => void;
  };
}

/**
 * Acts on the Map Editor's URL intents once their data is available: opening
 * the Building tool (`create`), locating or placing an indoor Location,
 * locating a Building or Location, and opening a Pathway for editing.
 */
export function useMapRouteIntents({
  route,
  data,
  current,
  indoor,
  pathway,
  toolSession,
  view,
}: UseMapRouteIntentsOptions) {
  useEffect(() => {
    const create = new URLSearchParams(route.search).get("create");
    if (create === "building") {
      toolSession.activateTool("polygon");
      return;
    }
  }, [route.search]);

  useEffect(() => {
    const indoorLocationId = new URLSearchParams(route.search).get("indoorLocation");
    if (indoorLocationId) {
      if (!data.loaded) return;
      const indoorLocation = current.locations.find((item) => item.id === indoorLocationId && isIndoorLocation(item));
      const parentBuilding = indoorLocation
        ? current.buildings.find((item) => item.id === indoorLocation.parentId || item.name === indoorLocation.building)
        : undefined;
      if (!indoorLocation || !parentBuilding) {
        view.setError("The indoor location or its parent Building could not be found.");
        route.navigate(route.pathname, { replace: true });
        return;
      }
      const shouldPlace = new URLSearchParams(route.search).get("place") === "1";
      view.setMode("select");
      view.setFrameBounds(null);
      view.setError("");
      if (isPositionedLocation(indoorLocation) && !shouldPlace) {
        indoor.setPlacement(null);
        view.setSelected({ type: "location", id: indoorLocation.id });
        view.flyTo([indoorLocation.lat, indoorLocation.lng], 20);
      } else {
        view.setSelected({ type: "location", id: indoorLocation.id });
        indoor.startPlacement(parentBuilding, indoorLocation);
        view.flyTo(polygonFeatureAnchor(parentBuilding.points), 20);
      }
      route.navigate(route.pathname, { replace: true });
      return;
    }

    const locationId = new URLSearchParams(route.search).get(
      "location",
    );
    const building = locationId ? current.buildings.find((item) => item.id === locationId) : undefined;
    const loc = locationId ? data.directoryLocations.find((item) => item.id === locationId) : undefined;
    if (locationId && (building || loc)) {
      const buildingPoints = building?.points ?? [];
      // Locations may locate an existing record, but it must never hand off
      // into a standalone point-placement workflow. Footprint geometry stays
      // owned by Map Editor's Building Polygon tool.
      view.setMode("select");
      if (building) {
        view.setSelected({ type: "building", id: locationId });
        if (buildingPoints.length >= 3) {
          view.setFrameBounds([
            [Math.min(...buildingPoints.map(([lat]) => lat)), Math.min(...buildingPoints.map(([, lng]) => lng))],
            [Math.max(...buildingPoints.map(([lat]) => lat)), Math.max(...buildingPoints.map(([, lng]) => lng))],
          ]);
        }
      } else if (loc) {
        view.setSelected({ type: "location", id: locationId });
      }
      if (!building && loc && isPositionedLocation(loc)) {
        view.setFrameBounds(null);
        view.flyTo([loc.lat, loc.lng]);
      }
    }
  }, [current.locations, current.buildings, data.loaded, data.directoryLocations, route.navigate, route.pathname, route.search]);

  useEffect(() => {
    const pathwayId = new URLSearchParams(route.search).get("pathway");
    if (!pathwayId) return;
    if (!data.loaded) return;
    const requested = data.overlayPathways.find((item) => item.id === pathwayId)
      ?? data.directoryPathways.find((item) => item.id === pathwayId);
    if (!requested) {
      view.setError("The requested Pathway is no longer available. Refresh the Walking Network and try again.");
      return;
    }
    view.setSelected({ type: "pathway", id: requested.id });
    pathway.setEditingPathId(requested.id);
    pathway.setPathwayDraft({ ...requested });
    pathway.setPathwayDraftOriginal({ ...requested });
    pathway.setPathPoints([...requested.pathPoints]);
    view.setMode("path");
    view.setError("");
    const source = current.nodes.find((node) => node.id === requested.sourceNodeId);
    if (source) view.flyTo([source.lat, source.lng]);
  }, [current.nodes, data.loaded, data.directoryPathways, data.overlayPathways, route.search]);
}
