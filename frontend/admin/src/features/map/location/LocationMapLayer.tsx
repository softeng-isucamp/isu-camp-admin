import { Marker, Popup, Tooltip } from "react-leaflet";
import type { Location } from "../../../types";
import { pointOnCampus, type MapPoint } from "../campusBoundary";
import { createLocationPinIcon } from "../mapIcons";

interface LocationMapLayerProps {
  locations: Array<Location & { lat: number; lng: number }>;
  selectedLocation: Pick<Location, "id" | "type"> | null;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onSelectLocation: (location: Location, anchor: MapPoint) => void;
}

/** Campus Location pins; only the selected one stays visible at overview zoom. */
export function LocationMapLayer({
  locations: filteredLocations,
  selectedLocation,
  campusBoundary,
  isOverviewZoom,
  onSelectLocation,
}: LocationMapLayerProps) {
  return (
    <>
      {filteredLocations.map((loc) => {
        const isSelected = selectedLocation !== null && selectedLocation.id === loc.id && selectedLocation.type === loc.type;
        if (isOverviewZoom && !isSelected) return null;
        return (
          <Marker
            key={`location:${loc.id}`}
            position={[loc.lat, loc.lng]}
            icon={createLocationPinIcon(isSelected)}
            eventHandlers={{
              click: () => {
                onSelectLocation(loc, [loc.lat, loc.lng]);
              },
            }}
          >
            {!isOverviewZoom && <Tooltip direction="top" offset={[0, -28]} className="map-label">
              <div className="font-bold text-xs">{loc.name}</div>
              <div className="text-[10px] text-gray-500 font-normal">{loc.type} · {loc.code}</div>
              {!pointOnCampus([loc.lat, loc.lng], campusBoundary) && (
                <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
              )}
            </Tooltip>}
            <Popup>
              <strong>{loc.name}</strong>
              <br />
              <small>{loc.type} · {loc.code}</small>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
