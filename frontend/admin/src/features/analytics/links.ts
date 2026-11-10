import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AnalyticsPlaceRef, DestinationType } from "../../types";

/** Locations narrowed to exactly these places, with `why` shown as the filter chip. */
export const locationsListLink = (places: AnalyticsPlaceRef[], why: string) =>
  `/locations?${new URLSearchParams({ ids: places.map((place) => place.id).join(","), why })}`;

/**
 * Locations narrowed to exactly these destinations of one type. A Place's ID and an indoor Location's ID can be the
 * same number, so each is sent as its typed identity key (`Place:12`, `Room:12`), never a bare ID.
 */
export const locationsKeysLink = (type: DestinationType, destinations: AnalyticsPlaceRef[], why: string) =>
  `/locations?${new URLSearchParams({ keys: destinations.map((place) => `${type === "Building" ? "Place" : type}:${place.id}`).join(","), why })}`;

/** The Map Editor with one pathway open. */
export const pathwayLink = (pathwayId: string) => `/map-editor?${new URLSearchParams({ pathway: pathwayId })}`;

/**
 * Navigate from a chart to the module it opens, at the top of the page: the router keeps the
 * window's scroll, which would land below the filter chip that explains the list.
 */
export function useOpenModule() {
  const navigate = useNavigate();
  return useCallback((to: string) => {
    navigate(to);
    window.scrollTo(0, 0);
  }, [navigate]);
}
