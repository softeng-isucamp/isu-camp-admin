import { useState } from "react";
import { Button, Field, Modal, SelectField } from "../../components/UI";
import type { Location, Pathway, RouteNode, Shade } from "../../types";

type RouteDetailsEntity =
  | { kind: "pathway"; value: Pathway }
  | { kind: "route_node"; value: RouteNode };

interface RouteDetailsModalProps {
  entity: RouteDetailsEntity;
  nodes: RouteNode[];
  locations: Location[];
  mode?: "add" | "edit";
  lockSpatialFields?: boolean;
  submitError?: string;
  onClose: () => void;
  onSubmit: (entity: Pathway | RouteNode) => void | Promise<void>;
}

export function RouteDetailsModal({ entity, nodes, locations, mode = "edit", lockSpatialFields = true, submitError = "", onClose, onSubmit }: RouteDetailsModalProps) {
  return entity.kind === "pathway" ? (
    <PathwayDetailsForm pathway={entity.value} nodes={nodes} mode={mode} lockSpatialFields={lockSpatialFields} submitError={submitError} onClose={onClose} onSubmit={onSubmit} />
  ) : (
    <RouteNodeDetailsForm node={entity.value} locations={locations} onClose={onClose} onSubmit={onSubmit} />
  );
}

function PathwayDetailsForm({ pathway, nodes, mode, lockSpatialFields, submitError, onClose, onSubmit }: {
  pathway: Pathway;
  nodes: RouteNode[];
  mode: "add" | "edit";
  lockSpatialFields: boolean;
  submitError: string;
  onClose: () => void;
  onSubmit: (entity: Pathway) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Pathway>({ ...pathway });
  const [error, setError] = useState("");
  const save = () => {
    if (!draft.sourceNodeId || !draft.destinationNodeId || draft.sourceNodeId === draft.destinationNodeId) {
      setError("Source and destination must be two distinct Route Nodes.");
      return;
    }
    onSubmit({ ...draft, id: pathway.id, pathPoints: pathway.pathPoints });
  };
  return (
    <Modal title={mode === "add" ? "Add Route / Path" : "Edit Route / Path"} subtitle={lockSpatialFields ? "Routes & Paths owns connectivity and traversal properties. Geometry remains locked to the Map Editor." : "Connect two campus nodes for navigation."} size="md" variant="green" onClose={onClose}>
      {(error || submitError) && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error || submitError}</div>}
      <div className="form-grid-two">
        <SelectField aria-label="SOURCE" label="SOURCE" required disabled={lockSpatialFields} title={lockSpatialFields ? "Pathway endpoints are changed by the topology workflow." : undefined} value={draft.sourceNodeId} onChange={(event) => setDraft({ ...draft, sourceNodeId: event.target.value })}>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.nodeType})</option>)}
        </SelectField>
        <SelectField aria-label="DESTINATION" label="DESTINATION" required disabled={lockSpatialFields} title={lockSpatialFields ? "Pathway endpoints are changed by the topology workflow." : undefined} value={draft.destinationNodeId} onChange={(event) => setDraft({ ...draft, destinationNodeId: event.target.value })}>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.nodeType})</option>)}
        </SelectField>
      </div>
      <div className="form-grid-two">
        <SelectField label="SHADE" required value={draft.shade} onChange={(event) => setDraft({ ...draft, shade: event.target.value as Shade })}>
          {["Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded", "Unknown"].map((value) => <option key={value}>{value}</option>)}
        </SelectField>
        <SelectField label="PATH TYPE" required value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
          {["Walkway", "Covered walkway", "Stairs", "Road crossing"].map((value) => <option key={value}>{value}</option>)}
        </SelectField>
      </div>
      <div className="form-grid-two">
        <Field label="NOTES" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <SelectField label="STATUS" required value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Pathway["status"] })}>
          <option>Open</option><option>Closed</option><option>Unknown</option>
        </SelectField>
      </div>
      {lockSpatialFields && <div className="borrowed-spatial-lock"><strong>🔒 Path connectivity and geometry</strong><span>{pathway.pathPoints.length} intermediate Path Points</span></div>}
      <div className="modal-actions"><Button variant="subtle" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Route</Button></div>
    </Modal>
  );
}

function RouteNodeDetailsForm({ node, locations, onClose, onSubmit }: {
  node: RouteNode;
  locations: Location[];
  onClose: () => void;
  onSubmit: (entity: RouteNode) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<RouteNode>({ ...node });
  return (
    <Modal title="Edit Route Node" subtitle="Routes & Paths owns node classification and Building association. Coordinates remain locked to the Map Editor." size="sm" variant="green" onClose={onClose}>
      <Field label="NODE NAME" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <SelectField label="NODE TYPE" required value={draft.nodeType} onChange={(event) => {
        const nodeType = event.target.value as RouteNode["nodeType"];
        setDraft({ ...draft, nodeType, associatedPlaceId: nodeType === "Entrance" ? draft.associatedPlaceId : null });
      }}>
        <option>Entrance</option><option>Junction</option><option>Access Point</option>
      </SelectField>
      <SelectField aria-label="Associated Location" label="ASSOCIATED BUILDING" value={draft.associatedPlaceId ?? ""} disabled={draft.nodeType !== "Entrance"} onChange={(event) => setDraft({ ...draft, associatedPlaceId: event.target.value || null })}>
        <option value="">None</option>
        {locations.filter((location) => location.type === "Building").map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </SelectField>
      <div className="borrowed-spatial-lock"><strong>🔒 Route Node position</strong><span>{node.lat.toFixed(6)}, {node.lng.toFixed(6)}</span></div>
      <div className="modal-actions"><Button variant="subtle" onClick={onClose}>Cancel</Button><Button onClick={() => onSubmit({ ...draft, id: node.id, lat: node.lat, lng: node.lng })}>Save Route Node</Button></div>
    </Modal>
  );
}
