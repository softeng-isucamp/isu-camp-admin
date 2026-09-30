import { Button, Modal } from "../../../components/UI";
import type { Building, Location } from "../../../types";
import { belongsToBuilding, isIndoorLocation } from "./indoorLocations";
import type { useIndoorLocationPlacement } from "./useIndoorLocationPlacement";

interface IndoorLocationChooserModalProps {
  indoor: ReturnType<typeof useIndoorLocationPlacement>;
  building: Building;
  contentLocations: Location[];
  error: string;
  onBeginPlacement: (building: Building, location: Location) => void;
}

/** Picks which existing Indoor Location of the selected Building to mark on the map. */
export function IndoorLocationChooserModal({
  indoor,
  building: selectedBuilding,
  contentLocations: buildingContentLocations,
  error,
  onBeginPlacement,
}: IndoorLocationChooserModalProps) {
  return (
    <Modal
      title="Mark indoor location"
      subtitle={`Choose an existing indoor location in ${selectedBuilding.name}, then click its position inside the building footprint.`}
      size="md"
      variant="green"
      onClose={() => indoor.setChooserOpen(false)}
    >
      <div className="max-h-[55vh] space-y-2 overflow-y-auto">
        {buildingContentLocations.filter((location) => isIndoorLocation(location) && belongsToBuilding(location, selectedBuilding)).map((location) => {
          const positioned = location.lat !== null && location.lng !== null;
          return (
            <div key={location.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe0e2] p-3">
              <div className="min-w-0">
                <strong className="block truncate text-sm text-[#191c1d]">{location.name}</strong>
                <span className="text-xs text-[#526359]">{location.floor ? `${location.floor} · ` : ""}{location.type} · {location.code}</span>
                <span className="block text-[10px] text-[#526359]">{positioned ? "Marker placed" : "No map marker"}</span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button onClick={() => onBeginPlacement(selectedBuilding, location)}>{positioned ? "Reposition" : "Place marker"}</Button>
                <Button variant="subtle" disabled={!positioned} onClick={() => indoor.clear(selectedBuilding, location)}>Clear</Button>
              </div>
            </div>
          );
        })}
        {!buildingContentLocations.some((location) => isIndoorLocation(location) && belongsToBuilding(location, selectedBuilding)) && (
          <p className="rounded-xl bg-[#f8faf9] p-4 text-sm text-[#526359]">This building has no Room, Office, Laboratory, or Restroom records yet. Use “Add indoor location” to create one first.</p>
        )}
      </div>
      {error && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <div className="modal-actions"><Button variant="subtle" onClick={() => indoor.setChooserOpen(false)}>Close</Button></div>
    </Modal>
  );
}
