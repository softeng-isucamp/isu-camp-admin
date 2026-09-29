import type { Pathway, RouteNode } from "../../../types";
import { suggestedPathwayName } from "../mapEditing";
import type { usePathwayEditing } from "./usePathwayEditing";

interface SelectedPathwayPanelProps {
  pathway: ReturnType<typeof usePathwayEditing>;
  path: Pathway;
  nodes: RouteNode[];
  onUpdate: (pathway: Pathway) => void;
  onReshape: (pathway: Pathway) => void;
  onClearSelection: () => void;
}

export function SelectedPathwayPanel({
  pathway,
  path: selectedPath,
  nodes: currentNodes,
  onUpdate,
  onReshape,
  onClearSelection,
}: SelectedPathwayPanelProps) {
  const { pathwayFrame, setPathwayDraft, adoptSuggestedPathwayName } = pathway;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Connection</div>
      <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Pathway name
        <input aria-label="Pathway name" placeholder={pathwayFrame && (suggestedPathwayName(pathwayFrame, currentNodes) || "Select two named Route Nodes")} value={pathwayFrame?.name ?? selectedPath.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(pathwayFrame); }} onBlur={() => adoptSuggestedPathwayName(pathwayFrame)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
      </label>
      <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Source</dt>
          <dd><select aria-label="Pathway source" value={selectedPath.sourceNodeId} onChange={(event) => onUpdate({ ...selectedPath, sourceNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Destination</dt>
          <dd><select aria-label="Pathway destination" value={selectedPath.destinationNodeId} onChange={(event) => onUpdate({ ...selectedPath, destinationNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Distance</dt>
          <dd className="text-[#191c1d] font-bold">{selectedPath.distance}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Walking Time</dt>
          <dd className="text-[#191c1d] font-bold">{selectedPath.time}</dd>
        </div>
        <div className="grid grid-cols-2 py-1.5 gap-2">
          <dt className="text-[#3f4941] font-medium">Intermediate Points</dt>
          <dd className="text-[#191c1d] font-bold">{selectedPath.pathPoints?.length || 0}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={() => onReshape(selectedPath)}
          className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
        >
          Edit Path Points
        </button>
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
