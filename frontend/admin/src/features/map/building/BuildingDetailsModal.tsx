import type { PlaceClassification } from "../../../types";
import { Button, Field, Modal, SelectField } from "../../../components/UI";
import { PLACE_CLASSIFICATIONS } from "../../../types";
import type { BuildingIdentityInput } from "./buildingFootprint";

interface BuildingDetailsModalProps {
  draft: BuildingIdentityInput;
  /** Empty until the admin chooses one: a new Place has no default Classification. */
  classification: PlaceClassification | "";
  classificationError?: string;
  error?: string;
  onChange: (draft: BuildingIdentityInput) => void;
  onClassificationChange: (classification: PlaceClassification) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting?: boolean;
}

export function BuildingDetailsModal({ draft, classification, classificationError, error, onChange, onClassificationChange, onClose, onSubmit, submitting = false }: BuildingDetailsModalProps) {
  return (
    <Modal
      title="Add Building"
      subtitle="Create a footprint-backed Building or Facility in the Locations directory."
      size="md"
      variant="green"
      onClose={onClose}
    >
      {error && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error}</div>}
      <div className="form-grid-two">
        <SelectField label="CLASSIFICATION" required value={classification} error={classificationError} onChange={(event) => onClassificationChange(event.target.value as PlaceClassification)} helper="College and Campus Services can contain indoor Locations; Food, Parking, and Facility cannot.">
          <option value="">Select a classification</option>
          {PLACE_CLASSIFICATIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </SelectField>
        <SelectField label="STATUS" required value={draft.status ?? "Active"} onChange={(event) => onChange({ ...draft, status: event.target.value as "Active" | "Inactive" })}>
          <option>Active</option><option>Inactive</option>
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
        <Button loading={submitting} onClick={onSubmit}>{submitting ? "Saving Building…" : "Save Building"}</Button>
      </div>
    </Modal>
  );
}
