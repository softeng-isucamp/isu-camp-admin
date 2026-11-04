import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/format";

export interface BuildingPickerItem {
  id: string;
  name: string;
  code?: string | null;
}

interface BuildingPickerProps<T extends BuildingPickerItem> {
  buildings: T[];
  /** The selected Building ID, or null for the none entry. */
  value: string | null;
  disabled?: boolean;
  error?: string;
  onChange: (building: T | null) => void;
  /** The visible, persistent label text. */
  label: string;
  /** Accessible name of the combobox; defaults to the label. */
  ariaLabel?: string;
  required?: boolean;
  /** The entry that clears the value, listed first so it is always reachable. */
  noneLabel: string;
  clearLabel: string;
  searchPlaceholder?: string;
  /**
   * The identifier shown beside the name and searched with it. Defaults to the code; supply a
   * fallback (for example the OSM id) so records without a code still differ from same-named ones.
   */
  identifierOf?: (building: T) => string | null | undefined;
  /** Compact sizing for the map panels. */
  compact?: boolean;
  labelClassName?: string;
}

/**
 * Picking a Building out of a campus-sized directory: one field that filters Buildings by
 * name or code as it is typed and lists the matches to choose from, by pointer or by keyboard.
 * Shared by the parent-Building field and the Route Node association pickers.
 */
export function BuildingPicker<T extends BuildingPickerItem>({
  buildings,
  value,
  disabled = false,
  error,
  onChange,
  label,
  ariaLabel = label,
  required = false,
  noneLabel,
  clearLabel,
  searchPlaceholder = "Type to search buildings by name or code…",
  identifierOf = (building) => building.code,
  compact = false,
  labelClassName = "field-label",
}: BuildingPickerProps<T>) {
  const inputId = useId();
  const listboxId = useId();
  const errorId = useId();
  const countId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(
    () => buildings.find((building) => building.id === value) ?? null,
    [buildings, value],
  );

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!trimmed) return buildings;
    return buildings.filter((building) =>
      building.name.toLowerCase().includes(trimmed)
      || (building.code ?? "").toLowerCase().includes(trimmed)
      || (identifierOf(building) ?? "").toLowerCase().includes(trimmed));
    // identifierOf is a pure projection; callers pass it inline.
  }, [buildings, trimmed]);

  // `null` is the standalone entry; it stays available so a chosen parent can be cleared.
  const options: Array<T | null> = useMemo(
    () => (trimmed && !noneLabel.toLowerCase().includes(trimmed) ? matches : [null, ...matches]),
    [matches, noneLabel, trimmed],
  );

  // A closed field shows what is selected; an open one shows what is being typed.
  const displayValue = open ? query : selected?.name ?? "";

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    // jsdom and older engines do not implement scrollIntoView; keeping the active
    // option in view is a nicety, never a requirement for choosing one.
    if (open) activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = () => {
    if (disabled || open) return;
    setQuery("");
    setOpen(true);
    setActiveIndex(0);
  };

  const closeList = () => {
    setOpen(false);
    setQuery("");
  };

  const commit = (building: T | null) => {
    onChange(building);
    closeList();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => Math.min(Math.max(current + step, 0), options.length - 1));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      // The dialog's Save button must not fire while a parent is being chosen.
      event.preventDefault();
      if (options.length) commit(options[Math.min(activeIndex, options.length - 1)]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      // The owning dialog closes on a document-level Escape. While the list is
      // open, Escape dismisses only the list and keeps the form's entries.
      event.stopPropagation();
      closeList();
      return;
    }
    if (event.key === "Tab" && open) closeList();
  };

  return (
    <div className={cx("field-group parent-building-field", compact ? "parent-building-compact" : "")} ref={containerRef}>
      <div className="field-label-row">
        <label className={labelClassName} htmlFor={inputId}>
          {label}
          {required && <span className="field-required" aria-hidden="true">*</span>}
        </label>
      </div>

      <div className="parent-building-combobox">
        <svg className="parent-building-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[open && trimmed ? countId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          autoComplete="off"
          className={cx("field-input parent-building-input", error ? "field-input-error" : "")}
          placeholder={selected ? selected.name : searchPlaceholder}
          disabled={disabled}
          value={displayValue}
          onFocus={openList}
          onClick={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {!disabled && selected && !open && (
          <button
            type="button"
            className="parent-building-clear"
            aria-label={clearLabel}
            onClick={() => commit(null)}
          >
            ✕
          </button>
        )}
        {!disabled && (
          <span className="parent-building-caret" aria-hidden="true">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        )}

        {open && (
          <div
            className="parent-building-popover"
            // Keep focus on the input so the list is not torn down before the click lands.
            onMouseDown={(event) => event.preventDefault()}
          >
            {trimmed && matches.length > 0 && (
              <p id={countId} className="parent-building-count" aria-live="polite">
                {`${matches.length} of ${buildings.length} buildings match “${query.trim()}”.`}
              </p>
            )}
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Matching buildings"
              className="parent-building-listbox"
            >
              {options.length === 0 && (
                <li className="parent-building-empty" role="presentation">
                  No buildings match “{query.trim()}”. Clear the search to see all {buildings.length}.
                </li>
              )}
              {options.map((building, index) => (
                <li
                  key={building?.id ?? "__standalone__"}
                  id={`${listboxId}-${index}`}
                  ref={index === activeIndex ? activeOptionRef : undefined}
                  role="option"
                  aria-selected={(building?.id ?? null) === value}
                  className={cx("parent-building-option", index === activeIndex ? "is-active" : "")}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(building)}
                >
                  <span className="parent-building-option-name">{building ? building.name : noneLabel}</span>
                  {building && identifierOf(building) && <span className="parent-building-option-code">{identifierOf(building)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <span id={errorId} className="field-error-msg">{error}</span>}
    </div>
  );
}
