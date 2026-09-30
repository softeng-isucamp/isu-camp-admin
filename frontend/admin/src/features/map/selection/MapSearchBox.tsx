import type { MapSearchResult } from "./useMapSearch";

interface MapSearchBoxProps {
  search: string;
  results: MapSearchResult[];
  onSearchChange: (search: string) => void;
  onSelectResult: (result: MapSearchResult) => void;
}

export function MapSearchBox({ search, results, onSearchChange, onSelectResult }: MapSearchBoxProps) {
  return (
    <div className={`map-glass-panel absolute right-4 top-4 z-[900] w-72 rounded-[20px] p-2`}>
      <div className="relative flex items-center">
        <svg className="w-4 h-4 absolute left-3 text-[#3f4941]/60 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search campus places..."
          className="w-full bg-[#f8f9fa] text-xs font-semibold py-2 pl-9 pr-7 rounded-xl outline-none focus:ring-2 focus:ring-[#005931]"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 text-xs font-bold text-[#005931]"
          >
            ×
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[#e1e3e4] max-h-56 overflow-y-auto text-xs">
          {results.map((item) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className="w-full text-left p-2 hover:bg-[#f8f9fa] rounded-lg flex items-center justify-between transition"
              onClick={() => onSelectResult(item)}
            >
              <span className="font-semibold text-[#191c1d]">{item.name}</span>
              <span className="text-[10px] text-[#3f4941] bg-[#e1e3e4] px-2 py-0.5 rounded-full">{item.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
