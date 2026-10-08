import { Spinner } from "../../../components/UI";
import type { Pathway, RouteNode } from "../../../types";
import { suggestedPathwayName } from "../mapEditing";
import type { SaveAction } from "../session/useSavingAction";
import type { usePathwayEditing } from "./usePathwayEditing";

interface PathwayToolPanelProps {
  pathway: ReturnType<typeof usePathwayEditing>;
  nodes: RouteNode[];
  directoryPathways: Pathway[];
  overlayPathways: Pathway[];
  savingAction: SaveAction | null;
  onNewPathway: () => void;
  onBrowseNetwork: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function PathwayToolPanel({
  pathway,
  nodes: currentNodes,
  directoryPathways,
  overlayPathways,
  savingAction,
  onNewPathway: startNewPathway,
  onBrowseNetwork,
  onSave: handleSavePathShape,
  onCancel,
}: PathwayToolPanelProps) {
  const {
    currentPathways,
    activePathway,
    editingPathId,
    setEditingPathId,
    pathwayDraft,
    setPathwayDraft,
    provisionalPathwayId,
    pathPoints,
    setPathPoints,
    selectedPathPointIndex,
    setSelectedPathPointIndex,
    pathStartNodeId,
    setPathDraftDirty,
    adoptSuggestedPathwayName,
    insertPathPoint,
  } = pathway;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Path Shape Points</div>
      <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Calibrate Path Points</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="px-3 py-1.5 bg-[#005931] text-white rounded-full text-xs font-bold" onClick={startNewPathway}>＋ New Pathway</button>
        <button
          type="button"
          className="px-3 py-1.5 border border-[#005931] bg-white text-[#005931] rounded-full text-xs font-bold"
          onClick={onBrowseNetwork}
        >Browse Walking Network</button>
      </div>
      {!activePathway && (
        <div className="mt-3 rounded-xl border border-[#dbe0e2] bg-[#f8f9fa] p-3 text-xs text-[#3f4941]">
          <p>Select two existing active Route Nodes on the map to create a new Pathway. The endpoints are kept as nodes; only intermediate clicks become Path Points.</p>
          <p className="mt-2 font-semibold">{pathStartNodeId ? `Start selected: ${currentNodes.find((node) => node.id === pathStartNodeId)?.name ?? "Route Node"}. Select a different node.` : "Select the first Route Node to begin."}</p>
        </div>
      )}
      {activePathway && (
        <>
          <section aria-label="Pathway metadata" className="mt-3 rounded-xl border border-[#dbe0e2] p-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#3f4941]">Pathway name
                <input aria-label="New Pathway name" placeholder={suggestedPathwayName(activePathway, currentNodes) || "Select two named Route Nodes"} value={pathwayDraft?.name ?? activePathway.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(activePathway); }} onBlur={() => adoptSuggestedPathwayName(activePathway)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
              </label>
              <label className="text-xs font-semibold text-[#3f4941]">Way type
                <select aria-label="New Pathway type" value={pathwayDraft?.type ?? activePathway.type} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                  {["Walkway", "Road"].map((wayType) => <option key={wayType}>{wayType}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#3f4941]">Shade
                <select aria-label="New Pathway shade" value={pathwayDraft?.shade ?? activePathway.shade} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs"><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-[#3f4941]">Direction<select aria-label="New Pathway direction" value={pathwayDraft?.direction ?? activePathway.direction} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs"><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
                <label className="text-xs font-semibold text-[#3f4941]">Status<select aria-label="New Pathway status" value={pathwayDraft?.status ?? activePathway.status} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">{activePathway.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></select></label>
              </div>
              <fieldset className="mt-2 rounded-xl border border-[#dbe0e2] p-2.5">
                <legend className="px-1 text-xs font-semibold text-[#3f4941]">Allowed modes</legend>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {["Walking", "Vehicle"].map((mode) => {
                    const allowedModes = pathwayDraft?.allowedModes ?? activePathway.allowedModes ?? ["Walking"];
                    const vehicleBlocked = (pathwayDraft?.type ?? activePathway.type) === "Walkway" && mode === "Vehicle";
                    return <label key={mode} className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={vehicleBlocked} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>;
                  })}
                </div>
              </fieldset>
            </div>
          </section>
          <div className="flex flex-col gap-1.5 my-3">
            <label className="text-xs font-semibold text-[#3f4941]">Pathway</label>
            <select
              value={editingPathId ?? ""}
              onChange={(e) => {
                setEditingPathId(e.target.value);
                const found = directoryPathways.find((p) => p.id === e.target.value) || overlayPathways.find((p) => p.id === e.target.value);
                if (found) {
                  setPathPoints(found.pathPoints || []);
                }
                setSelectedPathPointIndex(null);
              }}
              className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
            >
              {currentPathways.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-[#3f4941] my-2">
              Select a Path Point to drag it, or click the map to add Path Points.{" "}
            <strong>{pathPoints.length} points plotted</strong>.
          </p>
          <section aria-label="Pathway split handles" className="my-3 rounded-xl border border-[#dbe0e2] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#005931]">Midpoint split handles</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: pathPoints.length + 1 }, (_, segmentIndex) => (
                <button
                  key={segmentIndex}
                  type="button"
                  aria-label={`Add Path Point on segment ${segmentIndex + 1}`}
                  onClick={() => insertPathPoint(segmentIndex)}
                  className="h-7 w-7 rounded-full border border-[#005931] bg-white text-sm font-black text-[#005931]"
                >+</button>
              ))}
            </div>
          </section>
          {selectedPathPointIndex !== null && pathPoints[selectedPathPointIndex] && (
            <section aria-label="Selected Path Point" className="my-3 rounded-xl border border-[#dbe0e2] p-3">
              <label className="block text-xs font-semibold text-[#3f4941]">Latitude
                <input aria-label="Path Point latitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][0]} onChange={(event) => { setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [Number(event.target.value), point[1]] : point)); setPathDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
              </label>
              <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
                <input aria-label="Path Point longitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][1]} onChange={(event) => { setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [point[0], Number(event.target.value)] : point)); setPathDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
              </label>
            </section>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              disabled={!pathPoints.length}
              onClick={() => { setPathPoints((current) => selectedPathPointIndex === null
                ? current.slice(0, -1)
                : current.filter((_, index) => index !== selectedPathPointIndex)); setPathDraftDirty(true); }}
              className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
            >
              {selectedPathPointIndex === null ? "Remove Last Point" : "Remove Selected Point"}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
            <button
              type="button"
              className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingAction === "pathway"}
              onClick={handleSavePathShape}
              className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
            >
              {savingAction === "pathway" && <Spinner size={12} />}
              {savingAction === "pathway" ? "Saving Pathway…" : provisionalPathwayId === activePathway.id ? "Save Pathway" : "Update Pathway"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
