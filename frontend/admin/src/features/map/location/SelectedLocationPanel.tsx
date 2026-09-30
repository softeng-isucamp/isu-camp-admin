import type { Location } from "../../../types";

interface SelectedLocationPanelProps {
  location: Location;
  onUpdate: (location: Location) => void;
  onClearSelection: () => void;
}

export function SelectedLocationPanel({
  location: selectedLocation,
  onUpdate: updateLocation,
  onClearSelection,
}: SelectedLocationPanelProps) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Location</div>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Location name
        <input aria-label="Location name" value={selectedLocation.name} onChange={(event) => updateLocation({ ...selectedLocation, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
      </label>
      <div className="text-xs text-[#3f4941]">{selectedLocation.type} · Campus Location</div>
      <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Name</dt>
          <dd className="text-[#191c1d] font-bold">{selectedLocation.name}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Type</dt>
          <dd className="text-[#191c1d] font-bold">{selectedLocation.type}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Parent</dt>
          <dd className="text-[#191c1d] font-bold">{selectedLocation.building || selectedLocation.parentId || "—"}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Spatial source</dt>
          <dd className="text-[#191c1d] font-bold">{selectedLocation.type === "Building" || selectedLocation.type === "Facility" ? "Linked building footprint" : "Inherited from parent"}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <button type="button" onClick={onClearSelection} className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer">
          Clear Selection
        </button>
      </div>
    </div>
  );
}
