import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SpatialDomain, SpatialObjectType } from "./types";

export interface InspectorSummaryItem {
  label: string;
  value: string;
}

export interface InspectorAction {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledReason?: string;
}

export interface InspectorProvenance {
  osmId?: string;
  osmVersion?: number;
  importedAt?: string;
  license?: string;
  rawTags?: Record<string, string>;
}

export interface InspectorCardModel {
  id: string;
  kind: SpatialObjectType;
  title: string;
  domain: SpatialDomain;
  status?: string;
  readOnly?: boolean;
  summary: InspectorSummaryItem[];
  details?: ReactNode;
  primaryAction?: InspectorAction;
  overflowActions: InspectorAction[];
  provenance?: InspectorProvenance;
}

interface InspectorCardHUDProps {
  object: InspectorCardModel;
  onClose: () => void;
}

export function InspectorCardHUD({ object, onClose }: InspectorCardHUDProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const provenanceId = useId();

  useEffect(() => {
    setMenuOpen(false);
    setProvenanceOpen(false);
  }, [object.id, object.kind]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);

  return (
    <aside
      className="inspector-card-hud map-glass-panel"
      aria-label={`${object.title} object details`}
    >
      <header className="inspector-card-header">
        <div className="min-w-0">
          <div className="inspector-domain-badge">[{object.domain}]</div>
          <h2>{object.title}</h2>
          {object.status && <p>{object.status}</p>}
        </div>
        <div className="inspector-card-controls" ref={menuRef}>
          <button
            type="button"
            className="inspector-icon-button"
            aria-label={`More actions for ${object.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="inspector-overflow-menu" role="menu">
              {object.overflowActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  title={action.disabledReason}
                  className={action.tone === "danger" ? "danger" : undefined}
                  onClick={() => {
                    action.onSelect();
                    setMenuOpen(false);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="inspector-icon-button"
            aria-label="Clear object selection"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      {object.readOnly && (
        <div className="inspector-readonly-badge" role="status">
          [🔒 Read-Only Basemap]
        </div>
      )}

      <dl className="inspector-summary">
        {object.summary.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      {object.details}

      {object.provenance && (
        <section className="inspector-provenance">
          <button
            type="button"
            aria-expanded={provenanceOpen}
            aria-controls={provenanceId}
            onClick={() => setProvenanceOpen((open) => !open)}
          >
            <span>Source Lineage &amp; OSM Tags</span>
            <span aria-hidden="true">{provenanceOpen ? "▲" : "▼"}</span>
          </button>
          {provenanceOpen && (
            <div id={provenanceId} className="inspector-provenance-content">
              <dl>
                <div><dt>Source OSM ID</dt><dd>{object.provenance.osmId ?? "—"}</dd></div>
                <div><dt>Version</dt><dd>{object.provenance.osmVersion ?? "—"}</dd></div>
                <div><dt>Imported</dt><dd>{object.provenance.importedAt ?? "—"}</dd></div>
                <div><dt>Attribution</dt><dd>{object.provenance.license ?? "ODbL (OpenStreetMap contributors)"}</dd></div>
              </dl>
              <table>
                <caption>Preserved raw OSM tags</caption>
                <tbody>
                  {Object.entries(object.provenance.rawTags ?? {}).map(([key, value]) => (
                    <tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {object.primaryAction && (
        <footer className="inspector-card-footer">
          <button
            type="button"
            disabled={object.primaryAction.disabled}
            title={object.primaryAction.disabledReason}
            onClick={object.primaryAction.onSelect}
          >
            {object.primaryAction.label}
          </button>
        </footer>
      )}
    </aside>
  );
}
