import { useState } from "react";
import { services } from "../../../services/api";
import type { Building, Location } from "../../../types";
import { pointInPolygon, type MapPoint } from "../campusBoundary";
import type { MapOverlay } from "../session/useMapOverlay";
import { isPositionedLocation } from "./indoorLocations";

export interface IndoorPlacement {
  locationId: string;
  buildingId: string;
  position: MapPoint | null;
}

export interface IndoorPlacementContext {
  buildings: readonly Building[];
  locations: readonly Location[];
  zoom: number;
}

/** Indoor markers are only placed at close zoom, where a footprint is legible. */
export const INDOOR_PLACEMENT_MIN_ZOOM = 20;

const UNAVAILABLE = "Indoor location positioning is unavailable in this environment.";

/**
 * Placing, saving, and clearing an Indoor Location Marker inside its parent
 * Building's footprint (see ADR 0001).
 */
export function useIndoorLocationPlacement(overlay: MapOverlay, context: IndoorPlacementContext, onError: (message: string) => void) {
  const [placement, setPlacement] = useState<IndoorPlacement | null>(null);
  const [saving, setSaving] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);

  /** Starts placement for a location, seeded with its current marker, if any. */
  const startPlacement = (building: Building, location: Location) => {
    setPlacement({
      locationId: location.id,
      buildingId: building.id,
      position: isPositionedLocation(location) ? [location.lat, location.lng] : null,
    });
  };

  /** Starts placement from the chooser; returns false when the building has no footprint. */
  const begin = (building: Building, location: Location) => {
    if (building.points.length < 3) {
      onError(`${building.name} needs a footprint before an indoor location can be marked.`);
      return false;
    }
    setChooserOpen(false);
    startPlacement(building, location);
    onError("");
    return true;
  };

  const cancel = () => {
    setPlacement(null);
    onError("");
  };

  /** Moves the provisional marker to a clicked point. Returns whether placement consumed the click. */
  const handleMapClick = (point: MapPoint) => {
    if (!placement) return false;
    const building = context.buildings.find((item) => item.id === placement.buildingId);
    const location = context.locations.find((item) => item.id === placement.locationId);
    if (!building || !location) {
      onError("The selected indoor location or its building is no longer available.");
      setPlacement(null);
      return true;
    }
    if (context.zoom < INDOOR_PLACEMENT_MIN_ZOOM) {
      onError("Zoom in to level 20 or closer to place an indoor location marker.");
      return true;
    }
    if (!pointInPolygon(point, building.points)) {
      onError(`Place ${location.name} inside ${building.name}'s footprint.`);
      return true;
    }
    if (typeof services.locations.saveIndoorPosition !== "function") {
      onError(UNAVAILABLE);
      return true;
    }
    setPlacement((current) => current ? { ...current, position: point } : current);
    onError("");
    return true;
  };

  /** Persists the marker. Resolves to the positioned location, or null when nothing was saved. */
  const save = async (): Promise<Location | null> => {
    if (!placement?.position || saving) return null;
    const building = context.buildings.find((item) => item.id === placement.buildingId);
    const location = context.locations.find((item) => item.id === placement.locationId);
    if (!building || !location) {
      onError("The selected indoor location or its building is no longer available.");
      return null;
    }
    if (!pointInPolygon(placement.position, building.points)) {
      onError(`Place ${location.name} inside ${building.name}'s footprint.`);
      return null;
    }
    if (typeof services.locations.saveIndoorPosition !== "function") {
      onError(UNAVAILABLE);
      return null;
    }
    setSaving(true);
    onError("");
    try {
      const positioned = await services.locations.saveIndoorPosition({
        id: location.id,
        buildingId: building.id,
        lat: placement.position[0],
        lng: placement.position[1],
      });
      overlay.putLocation(positioned);
      setPlacement(null);
      return positioned;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : `Could not save ${location.name}'s position.`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const clear = async (building: Building, location: Location) => {
    if (typeof services.locations.saveIndoorPosition !== "function") {
      onError(UNAVAILABLE);
      return;
    }
    try {
      const cleared = await services.locations.saveIndoorPosition({
        id: location.id,
        buildingId: building.id,
        lat: null,
        lng: null,
      });
      overlay.putLocation(cleared);
      onError("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : `Could not clear ${location.name}'s map marker.`);
    }
  };

  return {
    placement,
    saving,
    chooserOpen,
    setChooserOpen,
    setPlacement,
    startPlacement,
    begin,
    cancel,
    handleMapClick,
    save,
    clear,
  };
}
