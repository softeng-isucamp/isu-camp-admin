import { useId, useRef, useState } from "react";
import { Spinner } from "../../components/UI";
import type { LocationPhotoDraft } from "../../types";
import { preparePhoto } from "./preparePhoto";

const MAX_PHOTOS = 10;

interface Props {
  photos: LocationPhotoDraft[];
  onChange: (photos: LocationPhotoDraft[]) => void;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
}

export function LocationPhotoUpload({ photos, onChange, loading = false, disabled = false, error }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  // Whether the feedback is something the person has to act on, rather than
  // read. A resize is reported the same way but is not a problem, so this is
  // tracked instead of inferred from the wording.
  const [problem, setProblem] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const galleryId = useId();
  const cover = photos.find((photo) => photo.isCover) ?? photos[0];

  const addFiles = async (files: FileList | File[] | null) => {
    if (loading || disabled || preparing || !files?.length) return;
    const rejected: string[] = [];
    const resized: string[] = [];
    const accepted: LocationPhotoDraft[] = [];
    setPreparing(true);
    try {
      for (const file of Array.from(files)) {
        if (photos.length + accepted.length >= MAX_PHOTOS) {
          rejected.push(`${file.name}: 10-photo limit reached`);
          continue;
        }
        // A photo over the server's 5 MB limit is re-encoded rather than
        // refused, because a camera photo is routinely over it and the record
        // cannot be saved until the upload fits. See preparePhoto.ts.
        const prepared = await preparePhoto(file);
        if (prepared.error) {
          rejected.push(`${file.name}: ${prepared.error}`);
          continue;
        }
        if (prepared.note) resized.push(`${file.name}: ${prepared.note}`);
        const ready = prepared.file;
        accepted.push({ id: `new:${crypto.randomUUID()}`, name: ready.name, type: ready.type, previewUrl: URL.createObjectURL?.(ready) ?? "", file: ready, isCover: photos.length + accepted.length === 0 });
      }
    } finally {
      setPreparing(false);
    }
    if (accepted.length) {
      onChange([...photos, ...accepted]);
      setExpanded(true);
    }
    const report = [...rejected, ...resized];
    if (accepted.length) report.push(`${accepted.length} photo${accepted.length === 1 ? "" : "s"} added.`);
    setProblem(rejected.length > 0);
    setFeedback(report.join(" · "));
  };

  const remove = (id: string) => {
    const removed = photos.find((photo) => photo.id === id);
    const remaining = photos.filter((photo) => photo.id !== id);
    if (removed?.file && removed.previewUrl) URL.revokeObjectURL?.(removed.previewUrl);
    if (removed?.isCover && remaining.length) remaining[0] = { ...remaining[0], isCover: true };
    onChange(remaining);
  };

  const thumbnails = photos.slice(0, 4);
  const hiddenCount = photos.length - thumbnails.length;
  const summary = loading ? "Loading photos…" : preparing ? "Preparing photos…" : cover ? `${cover.name} · Cover photo` : "PNG, JPEG, or WebP · large photos are resized to fit";
  const panelClass = ["photo-panel", dragging ? "is-dragging" : "", error || problem ? "has-problem" : ""].filter(Boolean).join(" ");

  return (
    <section aria-label="Location photos" className={panelClass} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <div className="photo-panel-row">
        <div className="photo-panel-summary">
          {thumbnails.length > 0 ? (
            <span className="photo-thumbs" aria-hidden="true">
              {thumbnails.map((photo) => <img key={photo.id} src={photo.previewUrl || undefined} alt="" />)}
              {hiddenCount > 0 && <span className="photo-thumbs-more">+{hiddenCount}</span>}
            </span>
          ) : null}
          <div className="photo-panel-text">
            <strong>Location photos ({photos.length}/10)</strong>
            <span>{(loading || preparing) && <Spinner size={12} />}{summary}</span>
          </div>
        </div>
        <div className="photo-panel-actions">
          <button type="button" className="photo-choose" disabled={loading || disabled || preparing || photos.length >= MAX_PHOTOS} onClick={() => inputRef.current?.click()}>Choose photos</button>
          <button type="button" className="photo-toggle" aria-label={expanded ? "Minimize photos" : "Show all photos"} title={expanded ? "Minimize photos" : "Show all photos"} aria-expanded={expanded} aria-controls={galleryId} onClick={() => setExpanded((current) => !current)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={expanded ? "is-open" : undefined}><path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload location photos" disabled={loading || disabled || preparing} hidden onChange={(event) => { const chosen = Array.from(event.target.files ?? []); event.currentTarget.value = ""; void addFiles(chosen); }} />
      </div>
      <div id={galleryId} hidden={!expanded}>
        <p className="photo-help">Drag images here or choose files. Up to 10 photos; anything over 5 MB is resized to fit.</p>
        <ul className="photo-grid">
          {photos.map((photo) => <li key={photo.id}>
            <div className="photo-card-head"><img src={photo.previewUrl || undefined} alt="" /><div><strong>{photo.name}</strong><span>{photo.isCover ? "Cover photo" : "Photo"}</span></div></div>
            <div className="photo-card-actions">{!photo.isCover && <button type="button" onClick={() => onChange(photos.map((item) => ({ ...item, isCover: item.id === photo.id })))} aria-label={`Make ${photo.name} cover photo`}>Make cover</button>}<button type="button" className="is-danger" onClick={() => remove(photo.id)} aria-label={`Remove ${photo.name}`}>Remove</button></div>
          </li>)}
        </ul>
      </div>
      {(error || feedback) && <p className="photo-feedback" role={error || problem ? "alert" : "status"}>{error || feedback}</p>}
    </section>
  );
}
