import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { MapSearchResult } from "./useMapSearch";
import { locationIdentityKey } from "../../../lib/locationPolicy";

interface MapSearchBoxProps {
  search: string;
  results: MapSearchResult[];
  onSearchChange: (search: string) => void;
  onSelectResult: (result: MapSearchResult) => void;
}

export function MapSearchBox({ search, results, onSearchChange, onSelectResult }: MapSearchBoxProps) {
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const query = search.trim();
  // The list (or its "no match" row) is open while there is a query and Escape has not closed it.
  const open = query !== "" && !dismissed;
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Typing a new query reopens the list from the top.
  useEffect(() => {
    setActiveIndex(-1);
    setDismissed(false);
  }, [search]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Escape closes the list first; only with it closed does it reach the map's own Escape handling.
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        setActiveIndex(-1);
      }
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      onSelectResult(results[activeIndex]);
    }
  };

  return (
    // The inspector card (z-index 901) opens below the search box; an open results list must sit above it, not behind it.
    <div className={`map-search-box map-glass-panel absolute right-4 top-4 w-72 rounded-[20px] p-2 ${open ? "map-search-box-open z-[903]" : "z-[900]"}`}>
      <div className="relative flex items-center">
        <svg className="w-4 h-4 absolute left-3 text-[#3f4941]/60 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          role="combobox"
          aria-label="Search campus places"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search campus places..."
          className="w-full bg-[#f8f9fa] text-xs font-semibold py-2 pl-9 pr-7 rounded-xl outline-none focus:ring-2 focus:ring-[#005931]"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 text-xs font-bold text-[#005931]"
          >
            ×
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div id={listId} role="listbox" aria-label="Search results" className="mt-2 pt-2 border-t border-[#e1e3e4] max-h-56 overflow-y-auto text-xs">
          {results.map((item, index) => (
            <div
              key={item.kind === "Location" ? locationIdentityKey(item) : `${item.kind}:${item.id}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`w-full cursor-pointer text-left p-2 rounded-lg flex items-center justify-between transition hover:bg-[#f8f9fa] ${index === activeIndex ? "bg-[#edf3ef] ring-1 ring-[#005931]" : ""}`}
              // Keep focus in the input so the arrow keys keep working after a pointer hover or click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelectResult(item)}
            >
              <span className="font-semibold text-[#191c1d]">{item.name}</span>
              <span className="text-[10px] text-[#3f4941] bg-[#e1e3e4] px-2 py-0.5 rounded-full">{item.kind}</span>
            </div>
          ))}
        </div>
      )}
      {open && results.length === 0 && (
        <div role="status" className="mt-2 pt-2 border-t border-[#e1e3e4] p-2 text-xs font-semibold text-[#3f4941]">
          No places match &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
