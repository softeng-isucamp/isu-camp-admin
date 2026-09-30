import { services } from "../../../services/api";
import type { Building, Location } from "../../../types";
import { isIndoorLocation } from "../indoorLocation/indoorLocations";
import type { MapOverlay } from "../session/useMapOverlay";
import type { SpatialDomain } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";

interface UseLocationDetailsSaveOptions {
  workingSession: WorkingSessionManager;
  overlay: MapOverlay;
  refreshMapData: () => Promise<void>;
}

/** What the Location details modal is editing. */
export interface LocationDetailsTarget {
  /** The selected Building, whose details are edited through its Location. */
  building: Building | undefined;
  /** The Campus Location record matching the selected Building, if any. */
  buildingLocation: Location | undefined;
  /** The selected Location (including indoor Locations). */
  location: Location | undefined;
}

/**
 * Saving Location details from the owner modal: persisting the record,
 * staging it in the overlay, and journaling the property edit.
 */
export function useLocationDetailsSave({ workingSession, overlay, refreshMapData }: UseLocationDetailsSaveOptions) {
  const recordPropertyOperation = (
    domain: SpatialDomain,
    entityId: string,
    before: object,
    after: object,
    description: string,
  ) => {
    workingSession.executeOperation({
      type: "update_properties",
      domain,
      entityId,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      description,
    });
  };

  const save = async (target: LocationDetailsTarget, updated: Location, photos: Parameters<typeof services.locations.save>[1]) => {
    const { building: selectedBuilding, buildingLocation: selectedBuildingLocation, location: selectedLocation } = target;
    if (selectedBuilding) {
      const savedLocation = typeof services.locations.save === "function"
        ? await services.locations.save(updated, photos)
        : updated;
      const updatedBuilding: Building = {
        ...selectedBuilding,
        name: savedLocation.name,
        code: savedLocation.code,
        type: savedLocation.type === "Facility" ? "Facility" : "Building",
        status: savedLocation.status,
      };
      overlay.putBuilding(updatedBuilding);
      overlay.putLocation({ ...savedLocation, id: selectedBuildingLocation?.id ?? savedLocation.id });
      recordPropertyOperation("Locations", selectedBuilding.id, selectedBuilding, updatedBuilding, `Edit ${selectedBuilding.name} details`);
    } else if (selectedLocation) {
      const savedRecord = typeof services.locations.save === "function"
        ? await services.locations.save(updated, photos)
        : updated;
      const savedLocation = isIndoorLocation(updated) && updated.parentId && typeof services.locations.saveIndoorPosition === "function"
        ? await services.locations.saveIndoorPosition({
            id: savedRecord.id,
            buildingId: updated.parentId,
            lat: updated.lat,
            lng: updated.lng,
          })
        : savedRecord;
      overlay.putLocation(savedLocation);
      recordPropertyOperation("Locations", selectedLocation.id, selectedLocation, savedLocation, `Edit ${selectedLocation.name} details`);
    }
    await refreshMapData();
  };

  return { save };
}
