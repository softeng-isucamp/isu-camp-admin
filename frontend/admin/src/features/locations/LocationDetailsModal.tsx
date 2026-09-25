import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Modal, SelectField } from "../../components/UI";
import { services } from "../../services/api";
import { locationPolicy } from "../../lib/locationPolicy";
import type { Location, LocationDraft, LocationPhotoDraft, LocationType } from "../../types";
import { LocationPhotoUpload } from "./LocationPhotoUpload";

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
  onPickOnMap,
  parentLabel,
}: Pick<Location, "lat" | "lng" | "positioned"> & {
  onPickOnMap?: () => void;
  parentLabel?: string;
}) {
  return (
    <section className="rounded-2xl border border-[#dbe5df] bg-[#f8fbf9] p-4" aria-label="Map coordinates">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#234333]">Map coordinates</h3>
          <p className="mt-1 text-[11px] text-[#526359]">
            {onPickOnMap
              ? `Coordinates for this indoor location inside ${parentLabel || "its parent building"}.`
              : "Position inherited from the mapped footprint."}
          </p>
        </div>
        {onPickOnMap && (
          <Button type="button" variant="subtle" className="shrink-0" onClick={onPickOnMap}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            Pick on map
          </Button>
        )}
      </div>
      <div className="form-grid-two">
        <Field
          aria-label="Latitude"
          label="LATITUDE"
          type="text"
          readOnly
          title={onPickOnMap ? "Read-only coordinate. Set it by picking a point on the map." : "Read-only coordinate"}
          value={positioned && lat !== null ? lat.toFixed(6) : "Not positioned"}
        />
        <Field
          aria-label="Longitude"
          label="LONGITUDE"
          type="text"
          readOnly
          title={onPickOnMap ? "Read-only coordinate. Set it by picking a point on the map." : "Read-only coordinate"}
          value={positioned && lng !== null ? lng.toFixed(6) : "Not positioned"}
        />
      </div>
    </section>
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
  onSubmit: (location: Location, photos: LocationPhotoDraft[]) => void | Promise<void>;
  onPickIndoorLocationOnMap?: () => void;
}

export function LocationDetailsModal({
  location,
  directory,
  allowedTypes,
  onClose,
  onSubmit,
  onPickIndoorLocationOnMap,
}: LocationDetailsModalProps) {
  const [draft, setDraft] = useState<Location>({ ...location });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<LocationPhotoDraft[]>([]);
  const photosRef = useRef<LocationPhotoDraft[]>(photos);
  photosRef.current = photos;
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const updateDraft = useCallback((next: Location) => setDraft(next), []);

  useEffect(() => {
    let active = true;
    void services.locations.getPhotos(location.id, location.type).then((loaded) => {
      if (active) setPhotos(loaded);
      else loaded.forEach((photo) => { if (photo.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl); });
    }).catch((cause) => {
      if (active) {
        setPhotoLoadFailed(true);
        setError(cause instanceof Error ? cause.message : "Unable to load location photos.");
      }
    }).finally(() => {
      if (active) setLoadingPhotos(false);
    });
    return () => {
      active = false;
      photosRef.current.forEach((photo) => { if (photo.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl); });
    };
  // Modal mounts for one selected Location and is unmounted on close.
  }, [location.id, location.type]);
  const effectiveAllowedTypes = allowedTypes ?? (
    location.type === "Building" || location.type === "Facility"
      ? ["Building", "Facility"]
      : undefined
  );

  const save = async (): Promise<boolean> => {
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
      return false;
    }
    if (evaluation.issues.length) {
      setError(evaluation.issues[0].message);
      return false;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        ...normalized,
        id: location.id,
        lat: draft.lat,
        lng: draft.lng,
        positioned: draft.lat !== null && draft.lng !== null,
      }, photos);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save location.");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const saveAndPickOnMap = async () => {
    if (await save()) onPickIndoorLocationOnMap?.();
  };

  return (
    <Modal
      title="Edit Location"
      subtitle={locationPolicy.classify(location.type).kind === "indoor"
        ? "Edit the room coordinates here or pick its position inside the parent Building on the map."
        : "Locations owns identity and descriptive fields. Building position comes from its footprint."}
      size="md"
      variant="green"
      onClose={onClose}
    >
      {error && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">{error}</div>}
      <LocationDetailsFields draft={draft} allowedTypes={effectiveAllowedTypes} onChange={(next) => setDraft(next as Location)} />
      <LocationPhotoUpload photos={photos} onChange={setPhotos} loading={loadingPhotos} />
      {locationPolicy.classify(draft.type).kind === "indoor" ? (
        <LocationCoordinatesFields
          lat={draft.lat}
          lng={draft.lng}
          positioned={draft.positioned}
          parentLabel={draft.building}
          onPickOnMap={onPickIndoorLocationOnMap ? () => { void saveAndPickOnMap(); } : undefined}
        />
      ) : (
        <LocationCoordinatesFields lat={draft.lat} lng={draft.lng} positioned={draft.positioned} />
      )}
      <div className="modal-actions">
        <Button variant="subtle" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button disabled={submitting || loadingPhotos || photoLoadFailed} onClick={save}>{submitting ? "Saving Location…" : "Save Location"}</Button>
      </div>
    </Modal>
  );
}
