import { Spinner } from "../../../components/UI";
import type { Building } from "../../../types";
import type { SaveAction } from "../session/useSavingAction";
import type { MapPoint } from "../campusBoundary";
import type { useRouteNodePointTool } from "./useRouteNodePointTool";

interface RouteNodePlacePanelProps {
  pointTool: ReturnType<typeof useRouteNodePointTool>;
  buildingAssociationOptions: Building[];
  campusCenter: MapPoint;
  savingAction: SaveAction | null;
  onSave: () => void;
  onCancel: () => void;
}

export function RouteNodePlacePanel({
  pointTool,
  buildingAssociationOptions,
  campusCenter,
  savingAction,
  onSave: handleSavePlacedNode,
  onCancel,
}: RouteNodePlacePanelProps) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Place on Map</div>
      <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Place Route Node</h2>
      <div className="flex flex-col gap-1.5 my-2">
        <label className="text-xs font-semibold text-[#3f4941]">Route Node type</label>
        <select
          aria-label="Route Node type"
          value={pointTool.placingNodeType}
          onChange={(e) => pointTool.setPlacingNodeType(e.target.value as "Entrance" | "Junction" | "Access Point")}
          className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
        >
          <option>Entrance</option>
          <option>Junction</option>
          <option>Access Point</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 my-2">
        <label className="text-xs font-semibold text-[#3f4941]">Route Node name</label>
        <input
          type="text"
          aria-label="Route Node name"
          placeholder="e.g. CAS Entrance"
          value={pointTool.placingNodeName}
          onChange={(e) => pointTool.setPlacingNodeName(e.target.value)}
          className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
        />
      </div>
      <div className="flex flex-col gap-1.5 my-2">
        <label className="text-xs font-semibold text-[#3f4941]">Building association</label>
        <select
          aria-label="Route Node association"
          value={pointTool.placingAssociatedBuildingId ?? ""}
          onChange={(e) => pointTool.setPlacingAssociatedBuildingId(e.target.value || null)}
          disabled={pointTool.placingNodeType !== "Entrance"}
          className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
        >
          <option value="">No Building association</option>
          {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>
            {building.name} ({building.code})
          </option>)}
        </select>
        <span className="mt-1 block text-[10px] text-[#526359]">Saved with the Route Node Save action.</span>
      </div>
      <div className="my-2 text-xs text-[#3f4941]">
        {pointTool.position
          ? `Preview position: ${pointTool.position[0].toFixed(5)}, ${pointTool.position[1].toFixed(5)}`
          : "Click the map to position this Route Node."}
      </div>
      <label className="block text-xs font-semibold text-[#3f4941]">Latitude
        <input aria-label="Placement latitude" type="number" step="any" value={pointTool.position?.[0] ?? ""} onChange={(e) => pointTool.editPosition([Number(e.target.value), pointTool.position?.[1] ?? campusCenter[1]])} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
      </label>
      <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
        <input aria-label="Placement longitude" type="number" step="any" value={pointTool.position?.[1] ?? ""} onChange={(e) => pointTool.editPosition([pointTool.position?.[0] ?? campusCenter[0], Number(e.target.value)])} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
      </label>
      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
          onClick={() => onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!pointTool.position || !pointTool.placingNodeName.trim() || savingAction === "route-node"}
          onClick={handleSavePlacedNode}
          className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
        >
          {savingAction === "route-node" && <Spinner size={12} />}
          {savingAction === "route-node" ? "Saving Route Node…" : "Save Route Node"}
        </button>
      </div>
    </div>
  );
}
