import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../lib/format";

/** How long a pause ends the typed prefix of a select-only type-ahead. */
const TYPE_AHEAD_RESET_MS = 500;

export interface FilterComboboxOption {
  id: string;
  name: string;
  code?: string | null;
  /** Lists the option under this heading. A group's options are listed together, groups in order of first appearance. */
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

/** The options that share a heading (or none), with each option's list position. */
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
  const fieldId = useId();
  const labelId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLElement | null>(null);
  const typeAheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: "", timer: null });
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value]);

  const trimmed = searchable ? query.trim().toLowerCase() : "";
  // `null` is the "all" entry; it stays available so a chosen filter can be cleared.
  const options: Array<FilterComboboxOption | null> = useMemo(() => {
    const matches = trimmed
      ? items.filter((item) =>
        item.name.toLowerCase().includes(trimmed) || (item.code ?? "").toLowerCase().includes(trimmed))
      : items;
    const listed = !trimmed || allLabel.toLowerCase().includes(trimmed) ? [null, ...matches] : matches;
    // List each group's options together, groups in order of first appearance, so
    // the flat numbering below is also the order on screen.
    const order: Array<string | null> = [];
    listed.forEach((item) => {
      const group = item?.group ?? null;
      if (!order.includes(group)) order.push(group);
    });
    return order.flatMap((group) => listed.filter((item) => (item?.group ?? null) === group));
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

  const labelOf = (item: FilterComboboxOption | null) => item?.name ?? allLabel;

  // A closed field shows what is selected; an open one shows what is being typed.
  const displayValue = open && searchable ? query : labelOf(selected);

  useEffect(() => () => {
    if (typeAheadRef.current.timer) clearTimeout(typeAheadRef.current.timer);
  }, []);

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
    fieldRef.current?.focus();
  };

  // Moves the highlight, opening the list first so a closed field answers the same keys.
  const highlight = (index: number) => {
    openList();
    setActiveIndex(index);
  };

  // The select-only pattern's type-ahead: typing "I" lands on "Inactive", and a
  // quick "In" narrows within that; repeating one letter cycles through its matches.
  const typeAhead = (character: string) => {
    const state = typeAheadRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.text += character.toLowerCase();
    state.timer = setTimeout(() => {
      state.text = "";
      state.timer = null;
    }, TYPE_AHEAD_RESET_MS);
    const cycling = [...state.text].every((letter) => letter === state.text[0]);
    const needle = cycling ? state.text[0] : state.text;
    const current = open ? highlighted : Math.max(0, items.findIndex((item) => item.id === value) + 1);
    // A single (or repeated) letter moves on to the next match; a longer prefix may stay put.
    const from = cycling ? current + 1 : current;
    for (let step = 0; step < options.length; step += 1) {
      const index = (from + step) % options.length;
      if (labelOf(options[index]).toLowerCase().startsWith(needle)) {
        highlight(index);
        return;
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Step from the shown highlight: a shrunk list clamps it below the stored index.
      setActiveIndex(Math.min(Math.max(highlighted + step, 0), options.length - 1));
      return;
    }
    if (!searchable && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      if (options.length) highlight(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
      && (event.key !== " " || typeAheadRef.current.text)) {
      event.preventDefault();
      typeAhead(event.key);
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
        <label className="field-label" id={labelId} htmlFor={searchable ? fieldId : undefined}>{label}</label>
      </div>

      <div className="parent-building-combobox">
        {searchable ? (
          <input
            id={fieldId}
            ref={(node) => { fieldRef.current = node; }}
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && options.length ? `${listboxId}-${highlighted}` : undefined}
            autoComplete="off"
            className="field-input filter-combobox-input"
            placeholder={`Search ${noun}…`}
            title={selected?.name}
            value={displayValue}
            // A type-ahead opens as soon as it is entered.
            onFocus={openList}
            onClick={openList}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        ) : (
          // Nothing to edit, so this is a focusable combobox rather than a read-only text box.
          <div
            id={fieldId}
            ref={(node) => { fieldRef.current = node; }}
            role="combobox"
            tabIndex={0}
            aria-labelledby={labelId}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && options.length ? `${listboxId}-${highlighted}` : undefined}
            className="field-input filter-combobox-input is-select-only"
            title={selected?.name}
            onClick={open ? closeList : openList}
            onKeyDown={handleKeyDown}
          >
            <span className="filter-combobox-value">{displayValue}</span>
          </div>
        )}
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
                    data-option-id={item?.id}
                    aria-selected={(item?.id ?? null) === value}
                    className={cx("parent-building-option", index === highlighted ? "is-active" : "")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(item)}
                  >
                    <span className="parent-building-option-name">{labelOf(item)}</span>
                    {item?.code && <span className="parent-building-option-code">{item.code}</span>}
                  </li>
                ));
                if (segment.group === null) return <Fragment key="__ungrouped__">{entries}</Fragment>;
                const headingId = `${listboxId}-group-${segmentIndex}`;
                return (
                  <ul key={`group-${segment.group}`} role="group" aria-labelledby={headingId} className="filter-combobox-group">
                    <li id={headingId} role="presentation" className="filter-combobox-group-heading">{segment.group}</li>
                    {entries}
                  </ul>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
