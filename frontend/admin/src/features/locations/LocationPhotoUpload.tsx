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

  return (
    <section aria-label="Location photos" onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }} style={{ border: `1px dashed ${error || problem ? "#dc2626" : dragging ? "#0c7441" : "#d1d5db"}`, borderRadius: 14, padding: 20, background: dragging ? "#ecf8f0" : "#f9fafb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 160 }}>
          {cover ? <img src={cover.previewUrl || undefined} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8 }} /> : <span aria-hidden="true" style={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 8, background: "#d6ede0", color: "#0c7441", fontSize: 22 }}>⇧</span>}
          <div><strong style={{ display: "block", color: "#191c1d", fontSize: 14 }}>Location photos ({photos.length}/10)</strong><span style={{ color: "#6b7280", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>{(loading || preparing) && <Spinner size={12} />}{loading ? "Loading photos…" : preparing ? "Preparing photos…" : cover ? `${cover.name} · Cover photo` : "PNG, JPEG, or WebP · large photos are resized to fit"}</span></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" disabled={loading || disabled || preparing || photos.length >= MAX_PHOTOS} onClick={() => inputRef.current?.click()} style={{ padding: "8px 12px", border: "1px solid #0c7441", borderRadius: 999, background: "white", color: "#0c7441", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Choose photos</button>
          <button type="button" aria-label={expanded ? "Minimize photos" : "Show all photos"} title={expanded ? "Minimize photos" : "Show all photos"} aria-expanded={expanded} aria-controls={galleryId} onClick={() => setExpanded((current) => !current)} style={{ display: "grid", placeItems: "center", width: 34, height: 34, border: "1px solid #d1d5db", borderRadius: "50%", background: "#e5e7eb", color: "#36463c", cursor: "pointer" }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : "none" }}><path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload location photos" disabled={loading || disabled || preparing} style={{ display: "none" }} onChange={(event) => { const chosen = Array.from(event.target.files ?? []); event.currentTarget.value = ""; void addFiles(chosen); }} />
      </div>
      <div id={galleryId} hidden={!expanded}>
        <p style={{ margin: "12px 0 0", color: "#6b7280", fontSize: 12 }}>Drag images here or choose files. Up to 10 photos; anything over 5 MB is resized to fit.</p>
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 10, margin: "14px 0 0", padding: 0, listStyle: "none" }}>
          {photos.map((photo) => <li key={photo.id} style={{ padding: 8, background: "white", border: "1px solid #e5e7eb", borderRadius: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><img src={photo.previewUrl || undefined} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7 }} /><div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{photo.name}</strong><span style={{ fontSize: 10, color: "#0c7441" }}>{photo.isCover ? "Cover photo" : "Photo"}</span></div></div>
            <div style={{ display: "flex", gap: 9, marginTop: 8, flexWrap: "wrap" }}>{!photo.isCover && <button type="button" onClick={() => onChange(photos.map((item) => ({ ...item, isCover: item.id === photo.id })))} aria-label={`Make ${photo.name} cover photo`} style={{ padding: 0, border: 0, background: "none", color: "#0c7441", fontSize: 11, textDecoration: "underline", cursor: "pointer" }}>Make cover</button>}<button type="button" onClick={() => remove(photo.id)} aria-label={`Remove ${photo.name}`} style={{ padding: 0, border: 0, background: "none", color: "#b42318", fontSize: 11, textDecoration: "underline", cursor: "pointer" }}>Remove</button></div>
          </li>)}
        </ul>
      </div>
      {(error || feedback) && <p role={error || problem ? "alert" : "status"} style={{ margin: "10px 0 0", color: error || problem ? "#b42318" : "#365047", fontSize: 12 }}>{error || feedback}</p>}
    </section>
  );
}
