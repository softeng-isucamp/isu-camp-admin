import { Marker, Tooltip } from "react-leaflet";
import type { Building, Location } from "../../../types";
import { createIndoorLocationIcon } from "../mapIcons";
import { belongsToBuilding } from "./indoorLocations";
import type { useIndoorLocationPlacement } from "./useIndoorLocationPlacement";

interface IndoorLocationMapLayersProps {
  indoor: ReturnType<typeof useIndoorLocationPlacement>;
  visibleLocations: Location[];
  contentLocations: Location[];
  buildings: Building[];
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string) => void;
}

/** Indoor Location markers, plus the preview marker for the Location being positioned. */
export function IndoorLocationMapLayers({
  indoor,
  visibleLocations: visibleIndoorLocations,
  contentLocations: buildingContentLocations,
  buildings: currentBuildings,
  selectedLocationId,
  onSelectLocation,
}: IndoorLocationMapLayersProps) {
  const indoorPlacement = indoor.placement;
  return (
    <>
      {visibleIndoorLocations.map((location) => {
        if (indoorPlacement?.locationId === location.id) return null;
        const isSelected = selectedLocationId === location.id;
        const building = currentBuildings.find((item) => belongsToBuilding(location, item));
        return (
          <Marker
            key={`indoor-location:${location.id}`}
            position={[location.lat!, location.lng!]}
            icon={createIndoorLocationIcon(location.type, isSelected)}
            eventHandlers={{
              click: () => onSelectLocation(location.id),
            }}
          >
            <Tooltip direction="top" offset={[0, -12]} className="map-label">
              <div className="font-bold text-xs">{location.name}</div>
              <div className="text-[10px] text-gray-500 font-normal">{building?.name ?? location.building} · {location.type}</div>
            </Tooltip>
          </Marker>
        );
      })}

      {indoorPlacement?.position && (() => {
        const location = buildingContentLocations.find((item) => item.id === indoorPlacement.locationId);
        return location ? <Marker
          key={`indoor-placement-preview:${location.id}`}
          position={indoorPlacement.position}
          icon={createIndoorLocationIcon(location.type, true)}
        /> : null;
      })()}
    </>
  );
}
