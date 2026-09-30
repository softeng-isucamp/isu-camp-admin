import type { Building, Location } from "../../../types";
import type { SelectedBuildingView } from "./selectedBuilding";

interface SelectedBuildingPanelProps {
  view: SelectedBuildingView;
  contentLocations: Location[];
  onUpdateBuilding: (building: Building) => void;
  onEditFootprint: () => void;
  onPlaceEntrance: () => void;
  onClearSelection: () => void;
}

export function SelectedBuildingPanel({
  view,
  contentLocations: buildingContentLocations,
  onUpdateBuilding: updateBuilding,
  onEditFootprint,
  onPlaceEntrance,
  onClearSelection,
}: SelectedBuildingPanelProps) {
  const { building: selectedBuilding, entrances: selectedBuildingEntrances, routable: selectedBuildingRoutable } = view;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Building</div>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Building name
        <input aria-label="Building name" value={selectedBuilding.name} onChange={(event) => updateBuilding({ ...selectedBuilding, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
      </label>
      <label className="mt-2 block text-[10px] font-bold text-[#3f4941]">Building code
        <input aria-label="Building code" value={selectedBuilding.code} onChange={(event) => updateBuilding({ ...selectedBuilding, code: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
      </label>
      <div className="text-xs text-[#3f4941] mt-2">Building footprint</div>
      <button
        type="button"
        className="mt-2 px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold"
        onClick={onEditFootprint}
      >
        Edit Footprint
      </button>
      <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Object Type</dt>
          <dd className="text-[#191c1d] font-bold">Building Area Footprint</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Routability</dt>
          <dd className={`font-bold ${selectedBuildingRoutable ? "text-[#005931]" : "text-amber-700"}`}>
            {selectedBuildingRoutable ? "Routable" : "Not routable"}
          </dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Code</dt>
          <dd className="text-[#191c1d] font-bold">{selectedBuilding.code}</dd>
        </div>
      </dl>
      <section aria-label="Building room directory" className="mt-4 rounded-xl border border-[#dbe0e2] p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold text-[#191c1d]">Room directory</h3>
        </div>
        {(() => {
          const children = buildingContentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name);
          const grouped = new Map<string, Location[]>();
          children.forEach((child) => { const key = child.floor || "Unassigned floor"; grouped.set(key, [...(grouped.get(key) ?? []), child]); });
          return grouped.size ? [...grouped.entries()].map(([floor, rooms]) => <div key={floor} className="mt-3"><div className="text-[10px] font-bold uppercase tracking-wide text-[#005931]">{floor}</div>{rooms.map((room) => <div key={room.id} className="flex justify-between gap-2 py-1 text-xs"><span className="font-semibold">{room.name}</span><span className="text-[#6b7280]">{room.code}</span></div>)}</div>) : <p className="mt-2 text-xs text-[#6b7280]">No rooms yet.</p>;
        })()}
      </section>
      <section aria-label="Building entrances" className="mt-3 rounded-xl border border-[#dbe0e2] p-3">
        <div className="flex items-center justify-between"><h3 className="text-xs font-extrabold text-[#191c1d]">Entrance nodes</h3><button type="button" className="text-[10px] font-bold text-[#005931]" onClick={onPlaceEntrance}>＋ Place Entrance</button></div>
        {selectedBuildingEntrances.length ? selectedBuildingEntrances.map((node) => <div key={node.id} className="flex justify-between gap-2 py-1 text-xs"><span>{node.name}</span><span className="text-[#6b7280]">{node.status === "Inactive" ? "Inactive" : "Active"}</span></div>) : <p className="mt-2 text-xs text-amber-700">No active Entrance Route Node. Add one to make this Building routable.</p>}
      </section>
      <div className="mt-4">
        <button
          type="button"
          onClick={onClearSelection}
          className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
