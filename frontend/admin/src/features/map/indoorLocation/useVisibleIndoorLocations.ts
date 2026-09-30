import { useMemo } from "react";
import type { Building, Location } from "../../../types";
import { belongsToBuilding, isIndoorLocation } from "./indoorLocations";

/** Positioned indoor Locations inside a current Building, shown only when zoomed in far enough. */
export function useVisibleIndoorLocations(contentLocations: Location[], buildings: Building[], zoom: number) {
  return useMemo(() => {
    if (zoom < 20) return [];
    return contentLocations.filter((location) =>
      isIndoorLocation(location)
      && location.lat !== null
      && location.lng !== null
      && buildings.some((building) => belongsToBuilding(location, building)),
    );
  }, [contentLocations, buildings, zoom]);
}
