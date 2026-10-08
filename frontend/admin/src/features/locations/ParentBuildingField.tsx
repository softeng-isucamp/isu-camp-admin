import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/format";
import type { Location } from "../../types";

interface ParentBuildingFieldProps {
  buildings: Location[];
  /** The selected Building ID, or null for None / Standalone. */
  value: string | null;
  disabled?: boolean;
  error?: string;
  onChange: (building: Location | null) => void;
}

/** The entry that clears the parent, listed first so it is always reachable. */
const standaloneLabel = "None / Standalone";

/**
 * Picking the parent Building out of a campus-sized directory: one field that
 * filters Buildings by name or code as it is typed and lists the matches to
 * choose from, by pointer or by keyboard.
 */
export function ParentBuildingField({
  buildings,
  value,
  disabled = false,
  error,
  onChange,
}: ParentBuildingFieldProps) {
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
      || (building.code ?? "").toLowerCase().includes(trimmed));
  }, [buildings, trimmed]);

  // `null` is the standalone entry; it stays available so a chosen parent can be cleared.
  const options: Array<Location | null> = useMemo(
    () => (trimmed && !standaloneLabel.toLowerCase().includes(trimmed) ? matches : [null, ...matches]),
    [matches, trimmed],
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

  const commit = (building: Location | null) => {
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
    <div className="field-group parent-building-field" ref={containerRef}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={inputId}>
          PARENT BUILDING
          <span className="field-required" aria-hidden="true">*</span>
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
          aria-label="PARENT BUILDING"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[open && trimmed ? countId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          autoComplete="off"
          className={cx("field-input parent-building-input", error ? "field-input-error" : "")}
          placeholder={selected ? selected.name : "Type to search buildings by name or code…"}
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
            aria-label="Clear parent building"
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
                  <span className="parent-building-option-name">{building?.name ?? standaloneLabel}</span>
                  {building?.code && <span className="parent-building-option-code">{building.code}</span>}
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
