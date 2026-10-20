import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../lib/format";

export interface FilterComboboxOption {
  id: string;
  name: string;
  code?: string | null;
  /** Lists the option under this heading. Options of one group are kept together, in order. */
  group?: string;
}

interface FilterComboboxProps {
  label: string;
  options: FilterComboboxOption[];
  /** The chosen option ID, or null for the "all" entry. */
  value: string | null;
  /** The entry that clears the filter, listed first so it is always reachable. */
  allLabel: string;
  /** What the options are, for the search placeholder and listbox name. */
  noun: string;
  /**
   * Whether typing narrows the options (the default). A short fixed list sets
   * this to false and gets a select-only field: the same popover, opened by
   * click or keyboard, with nothing to type.
   */
  searchable?: boolean;
  onChange: (id: string | null) => void;
}

/** One run of consecutive options that share a heading (or none), with each option's list position. */
interface OptionSegment {
  group: string | null;
  entries: Array<{ item: FilterComboboxOption | null; index: number }>;
}

/**
 * The dropdown behind every list filter (Locations, System Logs, User Management), so they all open the same popover.
 * By default it is a type-ahead for a campus-sized list: one field that narrows
 * the options by name or code as it is typed. With `searchable={false}` it is a
 * select-only combobox for a short fixed list. Either way the list scrolls
 * inside a limited height instead of the native select's full-height popup,
 * options can sit under group headings that keyboard navigation skips, and the
 * markup, ARIA and keyboard behavior are those of the parent-Building type-ahead.
 */
export function FilterCombobox({ label, options: items, value, allLabel, noun, searchable = true, onChange }: FilterComboboxProps) {
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value]);

  const trimmed = searchable ? query.trim().toLowerCase() : "";
  // `null` is the "all" entry; it stays available so a chosen filter can be cleared.
  const options: Array<FilterComboboxOption | null> = useMemo(() => {
    if (!trimmed) return [null, ...items];
    const matches = items.filter((item) =>
      item.name.toLowerCase().includes(trimmed) || (item.code ?? "").toLowerCase().includes(trimmed));
    return allLabel.toLowerCase().includes(trimmed) ? [null, ...matches] : matches;
  }, [items, trimmed, allLabel]);

  // A refresh can shrink the list while it is open, so the highlight never points past its end.
  const highlighted = Math.min(activeIndex, Math.max(options.length - 1, 0));

  // Headings are not options, so they take no index: the options keep one flat
  // numbering and ArrowUp/ArrowDown step over a heading without noticing it.
  const segments = useMemo(() => {
    const runs: OptionSegment[] = [];
    options.forEach((item, index) => {
      const group = item?.group ?? null;
      const last = runs[runs.length - 1];
      if (last && last.group === group) last.entries.push({ item, index });
      else runs.push({ group, entries: [{ item, index }] });
    });
    return runs;
  }, [options]);

  // A closed field shows what is selected; an open one shows what is being typed.
  const displayValue = open && searchable ? query : selected?.name ?? allLabel;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    // jsdom and older engines do not implement scrollIntoView; keeping the active
    // option in view is a nicety, never a requirement for choosing one.
    if (open) activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlighted]);

  const openList = () => {
    if (open) return;
    setQuery("");
    setOpen(true);
    // Start on the current choice so it is the option scrolled into view.
    setActiveIndex(Math.max(0, items.findIndex((item) => item.id === value) + 1));
  };

  const closeList = () => {
    setOpen(false);
    setQuery("");
  };

  const commit = (item: FilterComboboxOption | null) => {
    onChange(item?.id ?? null);
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
    if (!searchable && open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    // A select-only field has no text to edit, so Space picks (or opens) like Enter.
    if (event.key === "Enter" || (!searchable && event.key === " ")) {
      if (!open && searchable) return;
      event.preventDefault();
      if (!open) openList();
      else if (options.length) commit(options[highlighted]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    if (event.key === "Tab" && open) closeList();
  };

  return (
    <div className="field-group filter-combobox" ref={containerRef}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={inputId}>{label}</label>
      </div>

      <div className="parent-building-combobox">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete={searchable ? "list" : undefined}
          aria-activedescendant={open && options.length ? `${listboxId}-${highlighted}` : undefined}
          autoComplete="off"
          readOnly={!searchable}
          className={cx("field-input filter-combobox-input", searchable ? "" : "is-select-only")}
          placeholder={searchable ? `Search ${noun} by name or code…` : undefined}
          value={displayValue}
          // A type-ahead opens as soon as it is entered; a select-only field opens on click or key.
          onFocus={searchable ? openList : undefined}
          onClick={searchable || !open ? openList : closeList}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="parent-building-caret" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>

        {open && (
          <div
            className="parent-building-popover filter-combobox-popover"
            // Keep focus on the input so the list is not torn down before the click lands.
            onMouseDown={(event) => event.preventDefault()}
          >
            <ul
              id={listboxId}
              role="listbox"
              aria-label={searchable ? `Matching ${noun}` : `Available ${noun}`}
              className="parent-building-listbox filter-combobox-listbox"
            >
              {options.length === 0 && (
                <li className="parent-building-empty" role="presentation">
                  No {noun} match “{query.trim()}”.
                </li>
              )}
              {segments.map((segment, segmentIndex) => {
                const entries = segment.entries.map(({ item, index }) => (
                  <li
                    key={item?.id ?? "__all__"}
                    id={`${listboxId}-${index}`}
                    ref={index === highlighted ? activeOptionRef : undefined}
                    role="option"
                    aria-selected={(item?.id ?? null) === value}
                    className={cx("parent-building-option", index === highlighted ? "is-active" : "")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(item)}
                  >
                    <span className="parent-building-option-name">{item?.name ?? allLabel}</span>
                    {item?.code && <span className="parent-building-option-code">{item.code}</span>}
                  </li>
                ));
                if (segment.group === null) return entries;
                const headingId = `${listboxId}-group-${segmentIndex}`;
                return (
                  <li key={`group-${segment.group}`} role="presentation">
                    <div id={headingId} className="filter-combobox-group-heading">{segment.group}</div>
                    <ul role="group" aria-labelledby={headingId} className="filter-combobox-group">
                      {entries}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
