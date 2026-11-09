import type { AnalyticsPlaceRef } from "../../types";

/** Locations narrowed to exactly these places, with `why` shown as the filter chip. */
export const locationsListLink = (places: AnalyticsPlaceRef[], why: string) =>
  `/locations?${new URLSearchParams({ ids: places.map((place) => place.id).join(","), why })}`;

/** The Map Editor with one pathway open. */
export const pathwayLink = (pathwayId: string) => `/map-editor?${new URLSearchParams({ pathway: pathwayId })}`;
