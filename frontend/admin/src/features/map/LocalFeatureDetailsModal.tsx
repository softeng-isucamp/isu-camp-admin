import { useState } from "react";
import { Button, Field, Modal, SelectField } from "../../components/UI";
import type { LocalMapFeatureEntity } from "../../services/mapEditorApiClient";
import {
  LOCAL_FEATURE_ACCESS,
  LOCAL_FEATURE_DIRECTIONS,
  LOCAL_FEATURE_SURFACES,
  normalizeCuratedLocalFeatureProperties,
} from "./localFeatures";

interface LocalFeatureDetailsModalProps {
  feature: LocalMapFeatureEntity;
  onClose: () => void;
  onSubmit: (feature: LocalMapFeatureEntity) => void;
}

export function LocalFeatureDetailsModal({ feature, onClose, onSubmit }: LocalFeatureDetailsModalProps) {
  const [draft, setDraft] = useState(() => normalizeCuratedLocalFeatureProperties(feature));
  return (
    <Modal title="Edit Local Map Feature" subtitle="Local Map Data owns curated cartographic properties. Raw source tags and geometry are preserved separately." size="sm" variant="green" onClose={onClose}>
      <Field label="FEATURE NAME" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <SelectField label="SURFACE" value={draft.surface ?? "unknown"} onChange={(event) => setDraft({ ...draft, surface: event.target.value })}>
        {LOCAL_FEATURE_SURFACES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
      </SelectField>
      <SelectField label="ACCESS" value={draft.access ?? "unknown"} onChange={(event) => setDraft({ ...draft, access: event.target.value })}>
        {LOCAL_FEATURE_ACCESS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
      </SelectField>
      {draft.geometryType === "line" && (
        <SelectField label="DIRECTION" value={draft.direction ?? "both"} onChange={(event) => setDraft({ ...draft, direction: event.target.value })}>
          {LOCAL_FEATURE_DIRECTIONS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </SelectField>
      )}
      <div className="borrowed-spatial-lock"><strong>🔒 Source lineage</strong><span>Raw OSM tags remain unchanged by curated property edits.</span></div>
      <div className="modal-actions"><Button variant="subtle" onClick={onClose}>Cancel</Button><Button disabled={!draft.name.trim()} onClick={() => onSubmit(normalizeCuratedLocalFeatureProperties(draft))}>Save Feature</Button></div>
    </Modal>
  );
}
