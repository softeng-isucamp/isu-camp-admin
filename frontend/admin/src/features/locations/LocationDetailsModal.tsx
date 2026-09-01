import { useState } from "react";
import { Button, Field, Modal, SelectField } from "../../components/UI";
import { locationPolicy } from "../../lib/locationPolicy";
import type { Location, LocationDraft, LocationType } from "../../types";

interface LocationDetailsFieldsProps {
  draft: LocationDraft;
  allowedTypes?: LocationType[];
  errors?: Partial<Record<keyof LocationDraft, string>>;
  onChange: (draft: LocationDraft) => void;
  onTypeChange?: (type: LocationType) => void;
}

const defaultLocationTypes: LocationType[] = ["Laboratory", "Room", "Office", "Facility", "Building", "Restroom"];

export function LocationDetailsFields({
  draft,
  allowedTypes = defaultLocationTypes,
  errors = {},
  onChange,
  onTypeChange,
}: LocationDetailsFieldsProps) {
  return (
    <>
      <div className="form-grid-two">
        <SelectField
          label="LOCATION TYPE"
          required
          value={draft.type}
          onChange={(event) => {
            const type = event.target.value as LocationType;
            if (onTypeChange) onTypeChange(type);
            else onChange({ ...draft, type });
          }}
        >
          {allowedTypes.map((type) => <option key={type} value={type}>{type === "Floor" ? "Floor (legacy records only)" : type}</option>)}
        </SelectField>
        <SelectField
          label="STATUS"
          required
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as Location["status"] })}
        >
          <option>Active</option><option>Inactive</option><option>Unknown</option>
        </SelectField>
      </div>
      <div className="form-grid-two">
        <Field aria-label={draft.type === "Building" ? "Building name" : "Location name"} label="LOCATION NAME" required error={errors.name} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        <Field aria-label={draft.type === "Building" ? "Building code" : "Location code"} label="LOCATION CODE / ID" required error={errors.code} value={draft.code} onChange={(event) => onChange({ ...draft, code: event.target.value })} />
      </div>
      <Field aria-label="DESCRIPTION" label="DESCRIPTION" required error={errors.function} value={draft.function ?? ""} onChange={(event) => onChange({ ...draft, function: event.target.value })} />
      <Field aria-label="KEYWORDS / TAGS" label="KEYWORDS / TAGS" value={draft.keywords ?? ""} onChange={(event) => onChange({ ...draft, keywords: event.target.value })} />
    </>
  );
}

interface LocationDetailsModalProps {
  location: Location;
  directory: Location[];
  onClose: () => void;
  onSubmit: (location: Location) => void;
}

export function LocationDetailsModal({
  location,
  directory,
  onClose,
  onSubmit,
}: LocationDetailsModalProps) {
  const [draft, setDraft] = useState<Location>({ ...location });
  const [error, setError] = useState("");

  const save = () => {
    const normalized = locationPolicy.normalize(draft, {
      directory,
      previous: location,
    }) as Location;
    const evaluation = locationPolicy.evaluate(normalized, {
      context: "record",
      directory,
    });
    if (!normalized.name.trim() || !normalized.code.trim() || !String(normalized.function ?? "").trim()) {
      setError("Location name, code, and description are required.");
      return;
    }
    if (evaluation.issues.length) {
      setError(evaluation.issues[0].message);
      return;
    }
    onSubmit({
      ...normalized,
      id: location.id,
      lat: location.lat,
      lng: location.lng,
      positioned: location.positioned,
    });
  };

  return (
    <Modal
      title="Edit Location"
      subtitle="Locations owns identity and descriptive fields. Spatial position remains locked to the Map Editor."
      size="md"
      variant="green"
      onClose={onClose}
    >
      {error && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error}</div>}
      <LocationDetailsFields draft={draft} onChange={(next) => setDraft(next as Location)} />
      <div className="borrowed-spatial-lock" title="Coordinates are edited with the Map Editor spatial action.">
        <strong>🔒 Spatial position</strong>
        <span>{draft.positioned && draft.lat !== null && draft.lng !== null ? `${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)}` : "Not positioned"}</span>
      </div>
      <div className="modal-actions">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save Location</Button>
      </div>
    </Modal>
  );
}
