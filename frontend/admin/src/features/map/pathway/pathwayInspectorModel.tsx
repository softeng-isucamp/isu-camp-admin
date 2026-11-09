import type { CanPerform } from "../../../lib/permissions";
import { normalizePathwayLifecycleStatus, type Building, type Pathway, type RouteNode } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { suggestedPathwayName } from "../mapEditing";
import { PathwayStatusSelect } from "./PathwayStatusSelect";
import type { SaveAction } from "../session/useSavingAction";
import { calculateDeleteImpact, type DeleteImpact } from "../routeNode/routeNodeLifecycle";
import type { usePathwayEditing } from "./usePathwayEditing";

type PathwayInspectorSelection = { type: "pathway" | "path_point"; id: string } | null;

interface PathwayInspectorOptions {
  pathway: ReturnType<typeof usePathwayEditing>;
  nodes: RouteNode[];
  savingAction: SaveAction | null;
  /** What the signed-in administrator may do; an action they may not do is left out, not disabled. */
  can: CanPerform;
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

/** A Pathway that has never been saved says Save; a saved one says Update. */
function pathwaySaveLabel(saving: boolean, provisional: boolean) {
  if (provisional) return saving ? "Saving Pathway…" : "Save Pathway";
  return saving ? "Updating Pathway…" : "Update Pathway";
}

/** The Inspector card for a selected Pathway. */
export function selectedPathwayInspectorModel({
  pathway,
  path: selectedPath,
  nodes: currentNodes,
  buildings: currentBuildings,
  savingAction,
  can,
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
    adoptSuggestedPathwayName,
    switchEndpoints: switchPathwayEndpoints,
  } = pathway;
  // A Pathway that is still being created needs Add; a saved one needs Edit.
  const provisional = pathway.provisionalPathwayId === selectedPath.id;
  const canChange = can(provisional ? "add" : "edit");
  return {
    id: selectedPath.id,
    kind: "pathway",
    title: selectedPath.name || "Campus Pathway",
    domain: "Walking Network",
    objectLabel: "Pathway",
    subtitle: `${selectedPath.direction} · ${normalizePathwayLifecycleStatus(selectedPath.status)}${pathwayFrameDirty ? " · Unsaved draft" : ""}`,
    viewOnly: !canChange && !can("delete"),
    summary: [
      { label: "Source Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.sourceNodeId)?.name ?? pathwayFrame?.sourceNodeId ?? selectedPath.sourceNodeId },
      { label: "Destination Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.destinationNodeId)?.name ?? pathwayFrame?.destinationNodeId ?? selectedPath.destinationNodeId },
      // The editing controls below are the only place these show for someone who may edit, so everyone else reads them here.
      ...(canChange ? [] : [
        { label: "Way type", value: selectedPath.type },
        { label: "Shade", value: selectedPath.shade },
        { label: "Allowed modes", value: (selectedPath.allowedModes?.length ? selectedPath.allowedModes : ["Walking"]).join(", ") },
      ]),
    ],
    // Metadata, geometry and Cancel are all edits, so a view-only administrator keeps the facts above.
    details: canChange ? (
      <>
        <section className="inspector-section" aria-label="Pathway metadata">
          <h3>Pathway metadata</h3>
          <div className="inspector-edit-fields">
            <label>Pathway name<input aria-label="Pathway name" placeholder={pathwayFrame && (suggestedPathwayName(pathwayFrame, currentNodes) || "Select two named Route Nodes")} value={pathwayFrame?.name ?? selectedPath.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(pathwayFrame); }} onBlur={() => adoptSuggestedPathwayName(pathwayFrame)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
            <label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label>
            <label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label>
            <label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
            <PathwayStatusSelect value={pathwayFrame?.status} onChange={(status) => setPathwayDraft((current) => current ? { ...current, status } : current)} />
          </div>
          <fieldset className="inspector-modes"><legend>Allowed modes</legend><div>{["Walking", "Vehicle"].map((mode) => { const allowedModes = pathwayFrame?.allowedModes ?? ["Walking"]; const vehicleBlocked = pathwayFrame?.type === "Walkway" && mode === "Vehicle"; return <label key={mode}><input type="checkbox" disabled={vehicleBlocked} aria-describedby={vehicleBlocked ? "pathway-vehicle-blocked" : undefined} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>; })}</div>{pathwayFrame?.type === "Walkway" && <p id="pathway-vehicle-blocked" className="inspector-hint">Walkways allow walking only.</p>}</fieldset>
        </section>
        <section className="inspector-section" aria-label="Pathway geometry">
          <h3>Pathway geometry</h3>
          <button type="button" className="inspector-secondary-action" onClick={switchPathwayEndpoints} disabled={!pathwayFrame} aria-label="Switch source and destination">
            ⇄ Switch source and destination
          </button>
          {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
          {/* A Pathway still being created is already shaped by clicking the map; reshaping is for saved ones. */}
          {!provisional && <button type="button" className="inspector-secondary-action" onClick={() => onReshape(selectedPath)}>⌁ Reshape Pathway</button>}
          <div className="inspector-inline-actions"><button type="button" onClick={onCancel} disabled={!pathwayFrameDirty}>Cancel</button></div>
        </section>
      </>
    ) : undefined,
    primaryAction: canChange ? {
      // A new Pathway saves its shape (savingAction "pathway"); an existing one saves its metadata.
      label: pathwaySaveLabel(savingAction === (provisional ? "pathway" : "pathway-metadata"), provisional),
      disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === (provisional ? "pathway" : "pathway-metadata"),
      disabledReason: pathwayFrameIssues[0]?.message,
      onSelect: onApply,
    } : undefined,
    // Cancel and Reshape each live once, in the card body; the menu holds only what has no other home.
    overflowActions: [
      ...(can("delete") ? [{
        label: "🗑 Delete Pathway",
        tone: "danger" as const,
        separatorBefore: true,
        onSelect: () => {
          onDelete({ kind: "pathway", id: selectedPath.id, name: selectedPath.name, impact: calculateDeleteImpact({ object: selectedPath, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
        },
      }] : []),
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
  can,
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
  const pointParentProvisional = pathway.provisionalPathwayId === activePathway?.id;
  return {
    id,
    kind: "path_point",
    title: `Path Point #${selectedPathPointIndex + 1}`,
    domain: "Walking Network",
    objectLabel: "Path point",
    subtitle: `Point ${selectedPathPointIndex + 1} of ${pathPoints.length} · ${activePathway?.name || editingPathId}`,
    viewOnly: !can("edit") && !can("add"),
    summary: [
      { label: "Source Route Node", value: currentNodes.find((node) => node.id === activePathway?.sourceNodeId)?.name ?? activePathway?.sourceNodeId ?? "—" },
      { label: "Destination Route Node", value: currentNodes.find((node) => node.id === activePathway?.destinationNodeId)?.name ?? activePathway?.destinationNodeId ?? "—" },
      // The coordinate inputs below show the same numbers, so the summary lists them only when they are read-only.
      ...(pathway.canModify ? [] : [
        { label: "Latitude", value: point[0].toFixed(6) },
        { label: "Longitude", value: point[1].toFixed(6) },
      ]),
    ],
    details: (
      <>
        <section className="inspector-section" aria-label="Parent Pathway context"><h3>Parent Pathway</h3><p>{activePathway?.name ?? editingPathId}</p><p className="inspector-hint">{activePathway?.shade} · {activePathway?.type} · {activePathway?.direction} · {normalizePathwayLifecycleStatus(activePathway?.status)}</p></section>
        {pathway.canModify && <div className="inspector-point-inputs"><label>Latitude
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
        </label></div>}
        {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
        {(pathwayFrameDirty || pathDraftDirty) && <p className="inspector-notice" role="status">Update Pathway before converting this Path Point.</p>}
        {pathway.canModify && <section className="inspector-section" aria-label="Parent Pathway metadata"><h3>Parent Pathway metadata</h3><div className="inspector-edit-fields"><label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? activePathway?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label><label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? activePathway?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label><label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? activePathway?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label><PathwayStatusSelect value={pathwayFrame?.status ?? activePathway?.status} onChange={(status) => setPathwayDraft((current) => current ? { ...current, status } : current)} /></div></section>}
        {pathway.canModify && <div className="inspector-inline-actions"><button type="button" onClick={onCancel} disabled={!pathwayFrameDirty}>Cancel</button></div>}
      </>
    ),
    // Updating, cancelling and removing a point change the Pathway (Edit); converting a point creates a Route Node (Add).
    // Saving a Pathway still being created needs Add, the same as its parent inspector; an existing one needs Edit.
    primaryAction: can(pointParentProvisional ? "add" : "edit") ? {
      label: pathwaySaveLabel(savingAction === (pointParentProvisional ? "pathway" : "pathway-metadata"), pointParentProvisional),
      disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === (pointParentProvisional ? "pathway" : "pathway-metadata"),
      disabledReason: pathwayFrameIssues[0]?.message,
      onSelect: onApply,
    } : undefined,
    overflowActions: [
      // Update lives in the footer and Cancel beside the fields; the menu offers Cancel only when those fields are not shown.
      ...(can(pointParentProvisional ? "add" : "edit") && !pathway.canModify ? [{ label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: onCancel }] : []),
      ...(can("add") ? [{ label: "Convert to Route Node", disabled: pathwayFrameDirty || pathDraftDirty || activePathway?.status === "Closed", onSelect: onStartConversion }] : []),
      {
        label: "↩ Inspect Parent Pathway",
        onSelect: () => {
          setSelectedPathPointIndex(null);
          onSelect(activePathway ? { type: "pathway", id: activePathway.id } : null);
        },
      },
      ...(can("edit") ? [{
        label: "🗑 Remove Path Point",
        tone: "danger" as const,
        separatorBefore: true,
        onSelect: () => {
          setPathPoints((current) => current.filter((_, index) => index !== selectedPathPointIndex));
          setSelectedPathPointIndex(null);
          onSelect(activePathway ? { type: "pathway", id: activePathway.id } : null);
          setPathDraftDirty(true);
        },
      }] : []),
    ],
  } satisfies InspectorCardModel;
}
