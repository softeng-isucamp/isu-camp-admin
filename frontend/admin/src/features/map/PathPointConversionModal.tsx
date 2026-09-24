import { Button, Field, Modal, SelectField } from "../../components/UI";
import type { Pathway, RouteNode } from "../../types";
import { distanceInMeters } from "./pointInteractions";

export type PathPointConversionDraft = {
  pathwayId: string;
  index: number;
  point: [number, number];
  existingNodeId: string | null;
  node: Omit<RouteNode, "id">;
  pathways: [Pathway, Pathway];
};

type Props = {
  draft: PathPointConversionDraft;
  parentName: string;
  nodes: RouteNode[];
  buildings: { id: string; name: string; code: string }[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onNodeChange: (change: Partial<Omit<RouteNode, "id">>) => void;
  onPathwayChange: (index: 0 | 1, change: Partial<Pathway>) => void;
  onSave: () => void;
};

function segmentMetrics(pathway: Pathway, draft: PathPointConversionDraft, nodes: RouteNode[]) {
  const coordinate = (id: string): [number, number] | null => {
    if (id === "pending-conversion-node") return [draft.node.lat, draft.node.lng];
    const node = nodes.find((item) => item.id === id);
    return node ? [node.lat, node.lng] : null;
  };
  const source = coordinate(pathway.sourceNodeId);
  const destination = coordinate(pathway.destinationNodeId);
  if (!source || !destination) return "Calculated on Save";
  const points = [source, ...pathway.pathPoints, destination];
  const distance = points.slice(1).reduce((sum, point, index) => sum + distanceInMeters(points[index], point), 0);
  return `${Math.max(1, Math.round(distance))} m · ${Math.max(1, Math.ceil(distance / 80))} min`;
}

export function PathPointConversionModal({ draft, parentName, nodes, buildings, error, saving, onClose, onNodeChange, onPathwayChange, onSave }: Props) {
  const canSave = Boolean(
    (draft.existingNodeId || (draft.node.name.trim() && (draft.node.nodeType !== "Entrance" || draft.node.associatedPlaceId)))
      && draft.pathways.every((pathway) => pathway.name.trim() && pathway.allowedModes?.length),
  );

  return <Modal
    title="Convert Path Point to Route Node"
    subtitle={`Point ${draft.index + 1} on ${parentName}`}
    size="xl"
    className="path-point-conversion-modal"
    onClose={onClose}
  >
    <div className="conversion-form-scroll">
      <div className="record-information conversion-summary">
        <strong>NETWORK CHANGE</strong>
        <span>Path Point #{draft.index + 1} · {draft.point[0].toFixed(6)}, {draft.point[1].toFixed(6)}</span>
        <span>Saving closes the original Pathway and creates two connected Pathways.</span>
      </div>

      <section className="conversion-section" aria-label="Route Node metadata">
        <div className="conversion-section-heading"><span className="conversion-step">1</span><div><h3>Route Node</h3><p>The selected Path Point sets the node’s position.</p></div></div>
        {draft.existingNodeId
          ? <div className="record-information conversion-existing-node"><strong>EXISTING ROUTE NODE</strong><span>{nodes.find((node) => node.id === draft.existingNodeId)?.name ?? draft.existingNodeId}</span><span>This node will connect both replacement Pathways.</span></div>
          : <div className="conversion-fields">
              <Field id="conversion-node-name" aria-label="Converted Route Node name" label="ROUTE NODE NAME" required value={draft.node.name} onChange={(event) => onNodeChange({ name: event.target.value })} />
              <div className="form-grid-two">
                <SelectField id="conversion-node-type" aria-label="Converted Route Node type" label="NODE TYPE" required value={draft.node.nodeType} onChange={(event) => onNodeChange({ nodeType: event.target.value as RouteNode["nodeType"], associatedPlaceId: null })}>
                  <option>Junction</option><option>Access Point</option><option>Entrance</option>
                </SelectField>
                <SelectField id="conversion-node-building" aria-label="Converted Route Node Building" label="BUILDING ASSOCIATION" required={draft.node.nodeType === "Entrance"} disabled={draft.node.nodeType !== "Entrance"} helper={draft.node.nodeType === "Entrance" ? "Required for an Entrance." : "Available for Entrance nodes."} value={draft.node.associatedPlaceId ?? ""} onChange={(event) => onNodeChange({ associatedPlaceId: event.target.value || null })}>
                  <option value="">Select a Building</option>
                  {buildings.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
                </SelectField>
              </div>
            </div>}
      </section>

      <div className="conversion-section-heading"><span className="conversion-step">2</span><div><h3>Replacement Pathways</h3><p>Both begin with the original Pathway’s metadata. Edit each independently.</p></div></div>
      <div className="conversion-pathway-grid">
        {draft.pathways.map((pathway, index) => {
          const segment = index === 0 ? "A" : "B";
          const update = (change: Partial<Pathway>) => onPathwayChange(index as 0 | 1, change);
          return <section key={segment} className="conversion-section conversion-pathway" aria-label={`Replacement Pathway ${segment}`}>
            <div className="conversion-pathway-heading"><h4>Pathway {segment}</h4><span>{segmentMetrics(pathway, draft, nodes)}</span></div>
            <Field id={`conversion-pathway-${segment}-name`} aria-label={`Replacement Pathway ${segment} name`} label="PATHWAY NAME" required value={pathway.name} onChange={(event) => update({ name: event.target.value })} />
            <div className="form-grid-two">
              <SelectField id={`conversion-pathway-${segment}-type`} aria-label={`Replacement Pathway ${segment} way type`} label="WAY TYPE" value={pathway.type} onChange={(event) => update({ type: event.target.value, allowedModes: event.target.value === "Walkway" ? ["Walking"] : pathway.allowedModes })}><option>Walkway</option><option>Road</option></SelectField>
              <SelectField id={`conversion-pathway-${segment}-direction`} aria-label={`Replacement Pathway ${segment} direction`} label="DIRECTION" value={pathway.direction} onChange={(event) => update({ direction: event.target.value as Pathway["direction"] })}><option>Two-way</option><option>One-way</option><option>Unknown</option></SelectField>
              <SelectField id={`conversion-pathway-${segment}-shade`} aria-label={`Replacement Pathway ${segment} shade`} label="SHADE" value={pathway.shade} onChange={(event) => update({ shade: event.target.value as Pathway["shade"] })}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></SelectField>
              <SelectField id={`conversion-pathway-${segment}-status`} aria-label={`Replacement Pathway ${segment} status`} label="STATUS" value={pathway.status} onChange={(event) => update({ status: event.target.value as Pathway["status"] })}>{pathway.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></SelectField>
            </div>
            <fieldset className="conversion-modes"><legend className="field-label">ALLOWED MODES</legend>
              {(["Walking", "Vehicle"] as const).map((mode) => <label key={mode}><input type="checkbox" checked={pathway.allowedModes?.includes(mode) ?? mode === "Walking"} disabled={mode === "Vehicle" && pathway.type === "Walkway"} onChange={(event) => update({ allowedModes: event.target.checked ? [...new Set([...(pathway.allowedModes ?? []), mode])] : (pathway.allowedModes ?? []).filter((item) => item !== mode) })} />{mode}</label>)}
            </fieldset>
          </section>;
        })}
      </div>
      {error && <div role="alert" className="conversion-error">{error}</div>}
    </div>
    <div className="modal-actions conversion-actions">
      <Button variant="subtle" disabled={saving} onClick={onClose}>Cancel</Button>
      <Button disabled={saving || !canSave} onClick={onSave}>{saving ? "Saving…" : "Save Route Node and Pathways"}</Button>
    </div>
  </Modal>;
}
