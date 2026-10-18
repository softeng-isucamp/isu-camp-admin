import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/format";

export interface FilterComboboxOption {
  id: string;
  name: string;
  code?: string | null;
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
  onChange: (id: string | null) => void;
}

/**
 * A filter picked from a campus-sized list: one field that narrows the options
 * by name or code as it is typed. The list scrolls inside a limited height
 * instead of the full-height popup of a native select. It reuses the markup,
 * ARIA and keyboard behavior of the parent-Building type-ahead.
 */
export function FilterCombobox({ label, options: items, value, allLabel, noun, onChange }: FilterComboboxProps) {
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value]);

  const trimmed = query.trim().toLowerCase();
  // `null` is the "all" entry; it stays available so a chosen filter can be cleared.
  const options: Array<FilterComboboxOption | null> = useMemo(() => {
    if (!trimmed) return [null, ...items];
    const matches = items.filter((item) =>
      item.name.toLowerCase().includes(trimmed) || (item.code ?? "").toLowerCase().includes(trimmed));
    return allLabel.toLowerCase().includes(trimmed) ? [null, ...matches] : matches;
  }, [items, trimmed, allLabel]);

  // A refresh can shrink the list while it is open, so the highlight never points past its end.
  const highlighted = Math.min(activeIndex, Math.max(options.length - 1, 0));

  // A closed field shows what is selected; an open one shows what is being typed.
  const displayValue = open ? query : selected?.name ?? allLabel;

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
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      if (options.length) commit(options[highlighted]);
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
          aria-autocomplete="list"
          aria-activedescendant={open && options.length ? `${listboxId}-${highlighted}` : undefined}
          autoComplete="off"
          className="field-input filter-combobox-input"
          placeholder={`Search ${noun} by name or code…`}
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
              aria-label={`Matching ${noun}`}
              className="parent-building-listbox filter-combobox-listbox"
            >
              {options.length === 0 && (
                <li className="parent-building-empty" role="presentation">
                  No {noun} match “{query.trim()}”.
                </li>
              )}
              {options.map((item, index) => (
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
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
