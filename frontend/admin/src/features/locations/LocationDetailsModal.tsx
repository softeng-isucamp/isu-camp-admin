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
  statusEditable?: boolean;
}

const defaultLocationTypes: LocationType[] = ["Laboratory", "Room", "Office", "Facility", "Building", "Restroom"];

export function LocationCoordinatesFields({
  lat,
  lng,
  positioned,
}: Pick<Location, "lat" | "lng" | "positioned">) {
  return (
    <div className="form-grid-two">
      <Field
        aria-label="Latitude"
        label="LATITUDE"
        readOnly
        title="Read-only coordinate"
        value={positioned && lat !== null ? lat.toFixed(6) : "Not positioned"}
      />
      <Field
        aria-label="Longitude"
        label="LONGITUDE"
        readOnly
        title="Read-only coordinate"
        value={positioned && lng !== null ? lng.toFixed(6) : "Not positioned"}
      />
    </div>
  );
}

export function LocationDetailsFields({
  draft,
  allowedTypes = defaultLocationTypes,
  errors = {},
  onChange,
  onTypeChange,
  statusEditable = true,
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
          disabled={!statusEditable}
          helper={!statusEditable ? "Status is read-only until the backend persists lifecycle status." : undefined}
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
  allowedTypes?: LocationType[];
  onClose: () => void;
  onSubmit: (location: Location) => void | Promise<void>;
}

export function LocationDetailsModal({
  location,
  directory,
  allowedTypes,
  onClose,
  onSubmit,
}: LocationDetailsModalProps) {
  const [draft, setDraft] = useState<Location>({ ...location });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const effectiveAllowedTypes = allowedTypes ?? (
    location.type === "Building" || location.type === "Facility"
      ? ["Building", "Facility"]
      : undefined
  );

  const save = async () => {
    const normalized = locationPolicy.normalize(draft, {
      directory,
      previous: location,
    }) as Location;
    const evaluation = locationPolicy.evaluate(normalized, {
      context: "record",
      directory,
      currentId: location.id,
    });
    if (!normalized.name.trim() || !normalized.code.trim() || !String(normalized.function ?? "").trim()) {
      setError("Location name, code, and description are required.");
      return;
    }
    if (evaluation.issues.length) {
      setError(evaluation.issues[0].message);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        ...normalized,
        id: location.id,
        lat: location.lat,
        lng: location.lng,
        positioned: location.positioned,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save location.");
    } finally {
      setSubmitting(false);
    }
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
      <LocationDetailsFields draft={draft} allowedTypes={effectiveAllowedTypes} onChange={(next) => setDraft(next as Location)} />
      {locationPolicy.classify(draft.type).kind === "indoor" ? (
        <div className="borrowed-spatial-lock" title="Indoor locations inherit their position from the selected building.">
          <strong>🔒 Indoor Location</strong>
          <span>Floor context only · not independently routable</span>
        </div>
      ) : (
        <LocationCoordinatesFields lat={draft.lat} lng={draft.lng} positioned={draft.positioned} />
      )}
      <div className="modal-actions">
        <Button variant="subtle" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button disabled={submitting} onClick={save}>{submitting ? "Saving Location…" : "Save Location"}</Button>
      </div>
    </Modal>
  );
}
