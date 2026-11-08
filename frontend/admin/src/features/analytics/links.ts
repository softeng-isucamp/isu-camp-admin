import type { AnalyticsPlaceRef, ReadinessGap } from "../../types";

/** Quick links from the Analytics page into the module that fixes each thing. */
export const locationLink = (place: AnalyticsPlaceRef) => `/locations?${new URLSearchParams({ q: place.name, locationKey: place.id })}`;
export const mapLink = (place: AnalyticsPlaceRef) => `/map-editor?${new URLSearchParams({ location: place.id })}`;
/** Opens the Add Indoor Location form under this Place (needs the Add permission). */
export const addRoomLink = (place: AnalyticsPlaceRef) => `/locations?${new URLSearchParams({ add: "indoor", parentId: place.id })}`;
export const logsLink = (place: AnalyticsPlaceRef) => `/system-logs?${new URLSearchParams({ q: place.name, category: "Admin" })}`;

/** Where each gap gets fixed: the map for pins and entrances, the Add Room form for rooms, the directory for the rest. */
export const gapLink = (gap: ReadinessGap, place: AnalyticsPlaceRef) =>
  gap === "pin" || gap === "entrance" ? mapLink(place) : gap === "rooms" ? addRoomLink(place) : locationLink(place);

export const GAP_SHORT: Record<ReadinessGap, string> = {
  photo: "No photo",
  description: "No description",
  keywords: "No keywords",
  pin: "No map pin",
  entrance: "No entrance",
  rooms: "No rooms",
};

export const GAP_MODULE: Record<ReadinessGap, string> = {
  photo: "Locations",
  description: "Locations",
  keywords: "Locations",
  pin: "Map Editor",
  entrance: "Map Editor",
  rooms: "Locations",
};
