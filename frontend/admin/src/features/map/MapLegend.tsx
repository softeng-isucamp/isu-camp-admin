import { useState } from "react";

const legendItems = [
  { label: "Campus Location", symbolClass: "w-3 h-3 rounded-full bg-[#005931] border-2 border-white ring-1 ring-[#005931]" },
  { label: "Route Node", symbolClass: "w-3 h-3 rounded-full bg-[#2563eb] border-2 border-white ring-1 ring-[#1d4ed8]" },
  { label: "Path Point", symbolClass: "w-3 h-3 rounded-full bg-white border-2 border-[#005931]" },
  { label: "Walking Path", symbolClass: "w-4 border-t-2 border-dashed border-amber-600" },
  { label: "Building Footprint", symbolClass: "w-4 h-2.5 bg-[#8fd1bd]/50 border border-[#278b70]" },
];

export function MapLegend() {
  const [minimized, setMinimized] = useState(false);

  return (
    <div className={`map-glass-panel absolute bottom-4 left-4 z-[900] rounded-[24px] pointer-events-auto ${minimized ? "px-4 py-3" : "w-52 p-4"}`}>
      <div className={`flex items-center justify-between text-xs font-extrabold text-[#191c1d] ${minimized ? "gap-3" : "mb-2"}`}>
        <span>Map Legend</span>
        <button
          type="button"
          aria-label={minimized ? "Expand map legend" : "Minimize map legend"}
          aria-expanded={!minimized}
          onClick={() => setMinimized((current) => !current)}
          className="grid h-6 w-6 place-items-center rounded-full text-base leading-none text-[#3f4941] hover:bg-[#edf3ef]"
        >
          <span aria-hidden="true">{minimized ? "+" : "−"}</span>
        </button>
      </div>

      {!minimized && (
        <div className="flex flex-col gap-2 text-[11px] font-semibold text-[#3f4941]">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={item.symbolClass} aria-hidden="true" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
