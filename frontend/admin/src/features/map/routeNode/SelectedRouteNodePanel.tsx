import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { useRouteNodeFrame } from "./useRouteNodeFrame";

interface SelectedRouteNodePanelProps {
  node: RouteNode;
  frame: ReturnType<typeof useRouteNodeFrame>;
  locations: Location[];
  pathways: Pathway[];
  buildingAssociationOptions: Building[];
  onMove: () => void;
  onClearSelection: () => void;
}

export function SelectedRouteNodePanel({
  node: selectedNode,
  frame: nodeFrame,
  locations: currentLocations,
  pathways: directoryPathways,
  buildingAssociationOptions,
  onMove: handleStartMoveNode,
  onClearSelection,
}: SelectedRouteNodePanelProps) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Route Node</div>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node name
        <input aria-label="Route Node name" value={nodeFrame.frame?.name ?? selectedNode.name} onChange={(event) => nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
      </label>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node type
        <select aria-label="Route Node type" value={nodeFrame.frame?.nodeType ?? selectedNode.nodeType} onChange={(event) => { const nodeType = event.target.value as RouteNode["nodeType"]; nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), nodeType, associatedPlaceId: nodeType === "Entrance" ? nodeFrame.frame?.associatedPlaceId ?? null : null }); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
          <option>Entrance</option><option>Junction</option><option>Access Point</option>
        </select>
      </label>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Associated Building
        <select aria-label="Associated Building" value={nodeFrame.frame?.associatedPlaceId ?? ""} onChange={(event) => nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), associatedPlaceId: event.target.value || null })} disabled={(nodeFrame.frame?.nodeType ?? selectedNode.nodeType) !== "Entrance"} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs disabled:bg-[#f8f9fa]">
          <option value="">None</option>
          {selectedNode.associatedPlaceId && !currentLocations.some((location) => location.id === selectedNode.associatedPlaceId) && (
            <option value={selectedNode.associatedPlaceId}>Missing Building ({selectedNode.associatedPlaceId})</option>
          )}
          {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
        </select>
        <span className="mt-1 block text-[10px] text-[#526359]">Building choices are preview-only; this association is not persisted yet.</span>
      </label>
      <div className="text-xs text-[#3f4941]">{selectedNode.nodeType}</div>
      <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Node Type</dt>
          <dd className="text-[#191c1d] font-bold">{selectedNode.nodeType}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Latitude</dt>
          <dd className="text-[#191c1d] font-bold">{selectedNode.lat.toFixed(6)}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Longitude</dt>
          <dd className="text-[#191c1d] font-bold">{selectedNode.lng.toFixed(6)}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Connected Paths</dt>
          <dd className="text-[#191c1d] font-bold">
            {
              directoryPathways.filter(
                (p) =>
                  p.sourceNodeId === selectedNode.id ||
                  p.destinationNodeId === selectedNode.id,
              ).length
            }
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={handleStartMoveNode}
          className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
        >
          Move Node
        </button>
        <button
          type="button"
          onClick={() => onClearSelection()}
          className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
