import { Spinner } from "../../../components/UI";
import { BuildingPicker } from "../../locations/BuildingPicker";
import { buildingIdentifier } from "../building/buildingIdentifier";
import type { Building } from "../../../types";
import type { SaveAction } from "../session/useSavingAction";
import type { MapPoint } from "../campusBoundary";
import { coordinateRangeIssues, LATITUDE_HINT, LONGITUDE_HINT } from "./coordinateRange";
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
  const rangeIssues = coordinateRangeIssues(pointTool.position);
  const coordinatesValid = !rangeIssues.latitude && !rangeIssues.longitude;
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
      <div className="my-2">
        <BuildingPicker
          label="Building association"
          ariaLabel="Route Node association"
          buildings={buildingAssociationOptions}
          value={pointTool.placingAssociatedBuildingId}
          onChange={(building) => pointTool.setPlacingAssociatedBuildingId(building?.id ?? null)}
          disabled={pointTool.placingNodeType !== "Entrance"}
          noneLabel="No Building association"
          clearLabel="Clear Building association"
          searchPlaceholder="No Building association. Type to search by name or code…"
          identifierOf={buildingIdentifier}
          labelClassName="text-xs font-semibold text-[#3f4941]"
          compact
        />
        <span className="mt-1 block text-[10px] text-[#526359]">
          {pointTool.placingNodeType === "Entrance" ? "Saved with the Route Node Save action." : "Only an Entrance can be associated with a Building."}
        </span>
      </div>
      <div className="my-2 text-xs text-[#3f4941]">
        {pointTool.position
          ? `Preview position: ${pointTool.position[0].toFixed(5)}, ${pointTool.position[1].toFixed(5)}`
          : "Click the map to position this Route Node."}
      </div>
      <label className="block text-xs font-semibold text-[#3f4941]">Latitude
        <input aria-label="Placement latitude" aria-invalid={Boolean(rangeIssues.latitude)} aria-describedby="placement-latitude-note" type="number" step="any" min={-90} max={90} value={pointTool.position?.[0] ?? ""} onChange={(e) => pointTool.editPosition([Number(e.target.value), pointTool.position?.[1] ?? campusCenter[1]])} className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${rangeIssues.latitude ? "border-red-400" : "border-[#dbe0e2]"}`} />
        <span id="placement-latitude-note" className={`mt-0.5 block text-[10px] ${rangeIssues.latitude ? "text-red-700" : "font-normal text-[#526359]"}`} role={rangeIssues.latitude ? "alert" : undefined}>{rangeIssues.latitude ?? LATITUDE_HINT}</span>
      </label>
      <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
        <input aria-label="Placement longitude" aria-invalid={Boolean(rangeIssues.longitude)} aria-describedby="placement-longitude-note" type="number" step="any" min={-180} max={180} value={pointTool.position?.[1] ?? ""} onChange={(e) => pointTool.editPosition([pointTool.position?.[0] ?? campusCenter[0], Number(e.target.value)])} className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${rangeIssues.longitude ? "border-red-400" : "border-[#dbe0e2]"}`} />
        <span id="placement-longitude-note" className={`mt-0.5 block text-[10px] ${rangeIssues.longitude ? "text-red-700" : "font-normal text-[#526359]"}`} role={rangeIssues.longitude ? "alert" : undefined}>{rangeIssues.longitude ?? LONGITUDE_HINT}</span>
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
          disabled={!pointTool.position || !coordinatesValid || !pointTool.placingNodeName.trim() || savingAction === "route-node"}
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
