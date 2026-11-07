import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SpatialDomain, SpatialObjectType } from "./types";

export interface InspectorSummaryItem {
  label: string;
  value: ReactNode;
}

export interface InspectorAction {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledReason?: string;
  /** Draws a divider above this item (used to set Delete apart from the other actions). */
  separatorBefore?: boolean;
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
  /** The label above the title; defaults to the bracketed domain. */
  objectLabel?: string;
  /** One line under the title (for example a code and classification). */
  subtitle?: ReactNode;
  status?: string;
  /** True when the administrator may take none of this object's actions; the header then says "View only". */
  viewOnly?: boolean;
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const provenanceId = useId();

  useEffect(() => {
    setMenuOpen(false);
    setProvenanceOpen(false);
    // A newly selected object opens at its title; edits to the same object keep the scroll position.
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [object.id, object.kind]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);

  // Opening the menu moves focus to its first item.
  useEffect(() => {
    if (menuOpen) menuItems()[0]?.focus();
  }, [menuOpen]);

  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  const closeMenu = (returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  /** Escape closes only the menu (the map's Escape shortcut never sees it); arrows move between items; Tab closes it. */
  const onControlsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = menuItems();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1) % items.length
        : (current <= 0 ? items.length - 1 : current - 1);
      items[next].focus();
    }
  };

  return (
    <aside
      ref={cardRef}
      className="inspector-card-hud map-glass-panel"
      aria-label={`${object.title} object details`}
    >
      <header className="inspector-card-header">
        <div className="min-w-0">
          <div className="inspector-domain-badge">{object.objectLabel ?? `[${object.domain}]`}</div>
          <h2>{object.title}</h2>
          {object.subtitle && <p className="inspector-card-subtitle">{object.subtitle}</p>}
          {object.status && <p>{object.status}</p>}
          {object.viewOnly && <p className="inspector-view-only">View only</p>}
        </div>
        <div className="inspector-card-controls" ref={menuRef} onKeyDown={onControlsKeyDown}>
          {/* An admin who may do nothing with this object gets no ⋯ trigger either. */}
          {object.overflowActions.length > 0 && (
          <>
          <button
            type="button"
            ref={triggerRef}
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
              {object.overflowActions.map((action, index) => (
                <Fragment key={action.label}>
                  {action.separatorBefore && index > 0 && <div role="separator" />}
                  <button
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
                </Fragment>
              ))}
            </div>
          )}
          </>
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

      {object.summary.length > 0 && (
        <dl className="inspector-summary">
          {object.summary.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

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
