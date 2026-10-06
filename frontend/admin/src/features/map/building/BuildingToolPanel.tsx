import { polygonFeatureAnchor } from "../mapEditing";
import type { SaveAction } from "../session/useSavingAction";
import type { useBuildingFootprintEditing } from "./useBuildingFootprintEditing";

interface BuildingToolPanelProps {
  editor: ReturnType<typeof useBuildingFootprintEditing>;
  savingAction: SaveAction | null;
  onSave: () => void;
  /** Leaves the polygon tool for the building's details (Edit Details) modal. */
  onOpenDetails: (buildingId: string) => void;
}

export function BuildingToolPanel({ editor, savingAction, onSave: handleSaveBuilding, onOpenDetails }: BuildingToolPanelProps) {
  const {
    points,
    setPoints,
    polygonInteraction,
    setPolygonInteraction,
    polygonClosed,
    setPolygonClosed,
    setBuildingDetailsModalOpen,
    buildingName,
    buildingCode,
    editingBuildingId,
    footprintGeometryIssues,
    footprintOverlapWarning,
    canFinishFootprint,
    closePolygon,
    deletePolygonVertex,
    cancelDraft: cancelBuildingDraft,
  } = editor;
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Building Footprint</div>
      <h2 className="text-base font-extrabold text-[#191c1d] mt-1">{editingBuildingId ? "Change Building Footprint" : polygonClosed ? "Create Building" : "Draw Building Footprint"}</h2>
      {editingBuildingId ? (
        <section aria-label="Change scope" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <h3 className="text-xs font-extrabold text-[#005931]">Change scope</h3>
          <p className="mt-1 text-xs leading-5 text-[#3f4941]">
            This action edits only the linked Building Footprint geometry. The Building Campus Location and its details are unchanged.
          </p>
          <button
            type="button"
            className="mt-3 rounded-full border border-[#005931] bg-white px-3 py-1.5 text-xs font-bold text-[#005931]"
            onClick={() => {
              const buildingId = editingBuildingId;
              cancelBuildingDraft();
              if (buildingId) onOpenDetails(buildingId);
            }}
          >
            Open Building details ↗
          </button>
        </section>
      ) : polygonClosed ? (
        <section aria-label="Create Building" className="mt-3">
          <p className="text-xs text-[#3f4941]">The footprint is complete. Add the Building details to create it.</p>
          {footprintOverlapWarning && (
            <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800" role="status">
              ⚠️ {footprintOverlapWarning.message}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[#3f4941]">Add the Building identity and descriptive details before committing this footprint.</p>
            <button type="button" className="w-full rounded-xl border border-[#005931] bg-emerald-50 px-3 py-2 text-xs font-bold text-[#005931]" onClick={() => setBuildingDetailsModalOpen(true)}>
              {buildingName.trim() || buildingCode.trim() ? "Open Building details" : "Add Building details"}
            </button>
            {(buildingName.trim() || buildingCode.trim()) && <p className="text-[11px] text-[#526359]">{buildingName || "Unnamed Building"} {buildingCode ? `· ${buildingCode}` : ""}</p>}
          </div>
        </section>
      ) : (
        <div>
          <p className="text-xs text-[#3f4941] mt-1">
            Click on the map to plot the perimeter corners of the building footprint. A minimum of 3 points is required to form a closed polygon.
          </p>
          <div className="flex items-center gap-1 my-3 bg-[#edf3ef] p-1 rounded-xl" role="group" aria-label="Footprint interaction mode">
            <button
              type="button"
              onClick={() => setPolygonInteraction("draw")}
              className={`flex-1 rounded-lg py-1 text-xs font-bold ${polygonInteraction === "draw" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
            >
              Draw
            </button>
            <button
              type="button"
              disabled={points.length < 3}
              onClick={() => setPolygonInteraction("reshape")}
              className={`flex-1 rounded-lg py-1 text-xs font-bold disabled:opacity-40 ${polygonInteraction === "reshape" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
            >
              Reshape
            </button>
            <button
              type="button"
              disabled={points.length < 3}
              onClick={() => setPolygonInteraction("move")}
              className={`flex-1 rounded-lg py-1 text-xs font-bold disabled:opacity-40 ${polygonInteraction === "move" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
            >
              Move
            </button>
          </div>
        </div>
      )}
      <div className="text-xs font-bold text-[#191c1d] my-3">Points plotted: {points.length}</div>
      {points.length >= 3 && (
        <div className="mb-2 text-[11px] text-[#526359]">
          Derived label anchor: {polygonFeatureAnchor(points).map((c) => c.toFixed(5)).join(", ")}
        </div>
      )}
      {footprintGeometryIssues.length > 0 && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700" role="alert">
          {footprintGeometryIssues[0].message}
        </div>
      )}
      {!polygonClosed && footprintOverlapWarning && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800" role="status">
          ⚠️ {footprintOverlapWarning.message}
        </div>
      )}
      {points.length > 0 && polygonInteraction === "reshape" && (
        <div className="mb-3 space-y-1 max-h-36 overflow-y-auto">
          {points.map((point, index) => (
            <div key={`${point.join(",")}-${index}`} className="flex items-center justify-between rounded-lg bg-[#f8f9fa] px-2 py-1 text-xs">
              <span>V{index + 1} · {point[0].toFixed(5)}, {point[1].toFixed(5)}</span>
              <button type="button" disabled={points.length <= 3} onClick={() => deletePolygonVertex(index)} className="text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
            </div>
          ))}
        </div>
      )}
      {!polygonClosed && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            disabled={!points.length}
            onClick={() => setPoints((c) => c.slice(0, -1))}
            className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
          >
            Remove Last Point
          </button>
          <button
            type="button"
            disabled={!points.length}
            onClick={() => setPoints([])}
            className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
          >
            Clear Area
          </button>
          <button
            type="button"
            disabled={!canFinishFootprint}
            onClick={closePolygon}
            className="px-3 py-1.5 bg-emerald-50 border border-[#005931] text-[#005931] rounded-full text-xs font-bold hover:bg-emerald-100 disabled:opacity-40 transition cursor-pointer"
          >
            Save shape
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
        <button
          type="button"
          className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
          onClick={cancelBuildingDraft}
        >
          Cancel
        </button>
        {!editingBuildingId && polygonClosed && (
          <button
            type="button"
            className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
            onClick={() => setPolygonClosed(false)}
          >
            ▱ Edit Shape
          </button>
        )}
        {editingBuildingId && <button
          type="button"
          disabled={savingAction === "building" || !canFinishFootprint}
          onClick={handleSaveBuilding}
          className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
        >
          {savingAction === "building" ? "Saving Building Footprint…" : "Update Building Footprint"}
        </button>}
      </div>
    </div>
  );
}
