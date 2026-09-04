import { Button, Field, Modal, SelectField } from "../../components/UI";
import type { BuildingIdentityInput } from "./buildingFootprint";

interface BuildingDetailsModalProps {
  draft: BuildingIdentityInput;
  error?: string;
  onChange: (draft: BuildingIdentityInput) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function BuildingDetailsModal({ draft, error, onChange, onClose, onSubmit }: BuildingDetailsModalProps) {
  return (
    <Modal
      title="Add Building"
      subtitle="Create a Building record in the Locations directory."
      size="md"
      variant="green"
      onClose={onClose}
    >
      {error && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error}</div>}
      <div className="form-grid-two">
        <SelectField label="BUILDING TYPE" required value="Building" disabled helper="Map Editor creates canonical Building records in Locations.">
          <option value="Building">Building</option>
        </SelectField>
        <SelectField label="STATUS" required value="Active" disabled helper="Status is read-only for new map-created records.">
          <option>Active</option>
        </SelectField>
      </div>
      <div className="form-grid-two">
        <Field aria-label="Building name" label="BUILDING NAME" required value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        <Field aria-label="Building code" label="BUILDING CODE / ID" required value={draft.code} onChange={(event) => onChange({ ...draft, code: event.target.value })} />
      </div>
      <Field aria-label="Building function" label="DESCRIPTION" required value={draft.function ?? ""} onChange={(event) => onChange({ ...draft, function: event.target.value })} />
      <Field aria-label="Building keywords" label="KEYWORDS / TAGS" value={draft.keywords ?? ""} onChange={(event) => onChange({ ...draft, keywords: event.target.value })} />
      <p className="text-[11px] text-[#526359]">The footprint supplies the Building’s map anchor; no copied outdoor coordinate stored on Building.</p>
      <div className="modal-actions">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button onClick={onSubmit}>Save Building</Button>
      </div>
    </Modal>
  );
}
