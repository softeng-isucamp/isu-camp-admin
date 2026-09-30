import type { Building, Pathway, RouteNode } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { suggestedPathwayName } from "../mapEditing";
import type { SaveAction } from "../session/useSavingAction";
import { calculateDeleteImpact, type DeleteImpact } from "../routeNode/routeNodeLifecycle";
import type { usePathwayEditing } from "./usePathwayEditing";

type PathwayInspectorSelection = { type: "pathway" | "path_point"; id: string } | null;

interface PathwayInspectorOptions {
  pathway: ReturnType<typeof usePathwayEditing>;
  nodes: RouteNode[];
  savingAction: SaveAction | null;
  onSelect: (selection: PathwayInspectorSelection) => void;
  /** Applies the staged Pathway metadata; MapEditor closes the tool when the result says so. */
  onApply: () => void;
  onCancel: () => void;
}

interface SelectedPathwayInspectorOptions extends PathwayInspectorOptions {
  path: Pathway;
  buildings: Building[];
  onReshape: (pathway: Pathway) => void;
  onDelete: (confirmation: { kind: "pathway"; id: string; name: string; impact: DeleteImpact }) => void;
}

/** The Inspector card for a selected Pathway. */
export function selectedPathwayInspectorModel({
  pathway,
  path: selectedPath,
  nodes: currentNodes,
  buildings: currentBuildings,
  savingAction,
  onSelect,
  onApply,
  onCancel,
  onReshape,
  onDelete,
}: SelectedPathwayInspectorOptions): InspectorCardModel {
  const {
    currentPathways,
    pathwayFrame,
    pathwayFrameIssues,
    pathwayFrameDirty,
    setPathwayDraft,
    selectedPathPointIndex,
    setSelectedPathPointIndex,
    adoptSuggestedPathwayName,
    switchEndpoints: switchPathwayEndpoints,
  } = pathway;
  return {
    id: selectedPath.id,
    kind: "pathway",
    title: selectedPath.name || "Campus Pathway",
    domain: "Walking Network",
    status: `${selectedPath.direction} · ${selectedPath.status}${pathwayFrameDirty ? " · Unsaved draft" : ""}`,
    summary: [
      { label: "Source Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.sourceNodeId)?.name ?? pathwayFrame?.sourceNodeId ?? selectedPath.sourceNodeId },
      { label: "Destination Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.destinationNodeId)?.name ?? pathwayFrame?.destinationNodeId ?? selectedPath.destinationNodeId },
      { label: "Path Sequence", value: `${selectedPath.pathPoints.length} intermediate point${selectedPath.pathPoints.length === 1 ? "" : "s"}` },
      { label: "Distance", value: selectedPath.distance },
    ],
    details: (
      <>
        <section className="inspector-related-section" aria-label="Pathway metadata">
          <h3>Pathway metadata</h3>
          <div className="inspector-edit-fields">
            <label>Pathway name<input aria-label="Pathway name" placeholder={pathwayFrame && (suggestedPathwayName(pathwayFrame, currentNodes) || "Select two named Route Nodes")} value={pathwayFrame?.name ?? selectedPath.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(pathwayFrame); }} onBlur={() => adoptSuggestedPathwayName(pathwayFrame)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
            <label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label>
            <label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label>
            <label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
            <label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? "Active"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}>{pathwayFrame?.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></select></label>
          </div>
          <fieldset className="mt-2 rounded-xl border border-[#dbe0e2] p-2.5"><legend className="px-1 text-xs font-semibold text-[#3f4941]">Allowed modes</legend><div className="grid grid-cols-2 gap-2 text-xs">{["Walking", "Vehicle"].map((mode) => { const allowedModes = pathwayFrame?.allowedModes ?? ["Walking"]; const vehicleBlocked = pathwayFrame?.type === "Walkway" && mode === "Vehicle"; return <label key={mode} className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={vehicleBlocked} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>; })}</div></fieldset>
        </section>
        <section className="inspector-related-section" aria-label="Path Sequence editor">
          <h3>Path Sequence</h3>
          <button type="button" className="inspector-secondary-action" onClick={switchPathwayEndpoints} disabled={!pathwayFrame} aria-label="Switch source and destination">
            ⇄ Switch source and destination
          </button>
          <label className="inspector-point-selector">Select Path Point
            <select aria-label="Select Path Point" value={selectedPathPointIndex ?? ""} onChange={(event) => { const index = Number(event.target.value); setSelectedPathPointIndex(index); onSelect({ type: "path_point", id: `${selectedPath.id}:point:${index}` }); }}>
              <option value="" disabled>Choose an ordered point</option>
              {selectedPath.pathPoints.map((point, index) => <option key={`${index}-${point.join(",")}`} value={index}>Path Point #{index + 1} · {point[0].toFixed(6)}, {point[1].toFixed(6)}</option>)}
            </select>
          </label>
          {selectedPath.pathPoints.length === 0 && <p>No intermediate Path Points.</p>}
          {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
          <h3 className="inspector-subheading">Network findings</h3>
          <p>{pathwayFrameIssues.length ? `${pathwayFrameIssues.length} local finding${pathwayFrameIssues.length === 1 ? "" : "s"} require attention.` : "No locally known blocking findings."}</p>
          <button type="button" className="inspector-secondary-action" onClick={() => onReshape(selectedPath)}>⌁ Reshape Pathway</button>
          <div className="inspector-inline-actions"><button type="button" onClick={onCancel} disabled={!pathwayFrameDirty}>Cancel</button></div>
        </section>
      </>
    ),
    primaryAction: {
      label: savingAction === "pathway-metadata" ? "Updating Pathway…" : "Update Pathway",
      disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === "pathway-metadata",
      disabledReason: pathwayFrameIssues[0]?.message,
      onSelect: onApply,
    },
    overflowActions: [
      { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: onCancel },
      { label: "⌁ Reshape Pathway", onSelect: () => onReshape(selectedPath) },
      {
        label: "🗑 Delete Pathway",
        tone: "danger" as const,
        onSelect: () => {
          onDelete({ kind: "pathway", id: selectedPath.id, name: selectedPath.name, impact: calculateDeleteImpact({ object: selectedPath, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
        },
      },
    ],
  } satisfies InspectorCardModel;
}

interface PathPointInspectorOptions extends PathwayInspectorOptions {
  /** The selected Path Point's selection id. */
  id: string;
  onStartConversion: () => void;
}

/** The Inspector card for the selected Path Point of the Pathway being reshaped; null when none applies. */
export function pathPointInspectorModel({
  pathway,
  id,
  nodes: currentNodes,
  savingAction,
  onSelect,
  onApply,
  onCancel,
  onStartConversion,
}: PathPointInspectorOptions): InspectorCardModel | null {
  const {
    activePathway,
    pathwayFrame,
    pathwayFrameIssues,
    pathwayFrameDirty,
    editingPathId,
    setPathwayDraft,
    pathPoints,
    setPathPoints,
    selectedPathPointIndex,
    setSelectedPathPointIndex,
    pathDraftDirty,
    setPathDraftDirty,
  } = pathway;
  if (!editingPathId || selectedPathPointIndex === null || !pathPoints[selectedPathPointIndex]) return null;
  const point = pathPoints[selectedPathPointIndex];
  return {
    id,
    kind: "path_point",
    title: `Path Point #${selectedPathPointIndex + 1}`,
    domain: "Walking Network",
    status: `Nested geometry · ${selectedPathPointIndex + 1} of ${pathPoints.length}`,
    summary: [
      { label: "Source Route Node", value: currentNodes.find((node) => node.id === activePathway?.sourceNodeId)?.name ?? activePathway?.sourceNodeId ?? "—" },
      { label: "Destination Route Node", value: currentNodes.find((node) => node.id === activePathway?.destinationNodeId)?.name ?? activePathway?.destinationNodeId ?? "—" },
      { label: "Path Sequence", value: `${pathPoints.length} intermediate point${pathPoints.length === 1 ? "" : "s"}` },
      { label: "Latitude", value: point[0].toFixed(6) },
      { label: "Longitude", value: point[1].toFixed(6) },
    ],
    details: (
      <>
        <section className="inspector-related-section" aria-label="Parent Pathway context"><h3>Parent Pathway</h3><p>{activePathway?.name ?? editingPathId}</p><p>{activePathway?.shade} · {activePathway?.type} · {activePathway?.direction} · {activePathway?.status}</p></section>
        <label className="inspector-point-selector">Select Path Point
          <select aria-label="Select Path Point" value={selectedPathPointIndex} onChange={(event) => { const index = Number(event.target.value); setSelectedPathPointIndex(index); onSelect({ type: "path_point", id: `${editingPathId}:point:${index}` }); }}>
            {pathPoints.map((candidate, index) => <option key={`${index}-${candidate.join(",")}`} value={index}>Path Point #{index + 1} · {candidate[0].toFixed(6)}, {candidate[1].toFixed(6)}</option>)}
          </select>
        </label>
        <div className="inspector-point-inputs"><label>Latitude
          <input aria-label="Path Point latitude" type="number" step="any" value={point[0]} onChange={(event) => {
            setPathPoints((current) => current.map((item, index) => index === selectedPathPointIndex ? [Number(event.target.value), item[1]] : item));
            setPathDraftDirty(true);
          }} />
        </label>
        <label>Longitude
          <input aria-label="Path Point longitude" type="number" step="any" value={point[1]} onChange={(event) => {
            setPathPoints((current) => current.map((item, index) => index === selectedPathPointIndex ? [item[0], Number(event.target.value)] : item));
            setPathDraftDirty(true);
          }} />
        </label></div>
        {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
        {(pathwayFrameDirty || pathDraftDirty) && <p role="status">Update Pathway before converting this Path Point.</p>}
        <section className="inspector-related-section" aria-label="Parent Pathway metadata"><h3>Parent Pathway metadata</h3><div className="inspector-edit-fields"><label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? activePathway?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label><label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? activePathway?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label><label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? activePathway?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label><label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? activePathway?.status ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}><option>Open</option><option>Closed</option><option>Unknown</option></select></label></div></section>
        <div className="inspector-inline-actions"><button type="button" onClick={onCancel} disabled={!pathwayFrameDirty}>Cancel</button></div>
      </>
    ),
    primaryAction: {
      label: savingAction === "pathway-metadata" ? "Updating Pathway…" : "Update Pathway",
      disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === "pathway-metadata",
      disabledReason: pathwayFrameIssues[0]?.message,
      onSelect: onApply,
    },
    overflowActions: [
      { label: "✓ Update Pathway", onSelect: onApply },
      { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: onCancel },
      { label: "Convert to Route Node", disabled: pathwayFrameDirty || pathDraftDirty || activePathway?.status === "Closed", onSelect: onStartConversion },
      {
        label: "↩ Inspect Parent Pathway",
        onSelect: () => {
          setSelectedPathPointIndex(null);
          onSelect(activePathway ? { type: "pathway", id: activePathway.id } : null);
        },
      },
      {
        label: "🗑 Remove Path Point",
        tone: "danger" as const,
        onSelect: () => {
          setPathPoints((current) => current.filter((_, index) => index !== selectedPathPointIndex));
          setSelectedPathPointIndex(null);
          onSelect(activePathway ? { type: "pathway", id: activePathway.id } : null);
          setPathDraftDirty(true);
        },
      },
    ],
  } satisfies InspectorCardModel;
}
