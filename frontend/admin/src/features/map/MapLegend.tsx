import { useEffect, useState } from "react";
import { LocationTypeIcon } from "../locations/LocationTypeIcon";

const legendItems = [
  { label: "Campus Location", symbolClass: "w-3 h-3 rounded-full bg-[#005931] border-2 border-white ring-1 ring-[#005931]" },
  { label: "Route Node", symbolClass: "w-3 h-3 rounded-full bg-[#2563eb] border-2 border-white ring-1 ring-[#1d4ed8]" },
  { label: "Path Point", symbolClass: "w-3 h-3 rounded-full bg-white border-2 border-[#005931]" },
  { label: "Walkway", symbolClass: "w-4 border-t-2 border-dashed border-[#005931]" },
  { label: "Road", symbolClass: "w-4 border-t-[3px] border-[#1d4ed8]" },
  { label: "Building Footprint", symbolClass: "w-4 h-2.5 bg-[#8fd1bd]/50 border border-[#278b70]" },
];

interface MapLegendProps {
  /** An inspector is open: show the legend minimized unless it is expanded while the inspector is open. */
  yieldToInspector?: boolean;
}

export function MapLegend({ yieldToInspector = false }: MapLegendProps) {
  // The administrator's own choice; an open inspector never overwrites it, so it returns when the inspector closes.
  const [chosenMinimized, setChosenMinimized] = useState(true);
  const [expandedOverInspector, setExpandedOverInspector] = useState(false);
  useEffect(() => {
    if (!yieldToInspector) setExpandedOverInspector(false);
  }, [yieldToInspector]);
  const minimized = chosenMinimized || (yieldToInspector && !expandedOverInspector);
  const toggle = () => {
    if (yieldToInspector) {
      // Expanding over the inspector is explicit and lasts until it closes; minimizing there is kept too.
      setExpandedOverInspector(minimized);
      setChosenMinimized(!minimized);
      return;
    }
    setChosenMinimized(!minimized);
  };

  return (
    <div className={`map-glass-panel rounded-[24px] pointer-events-auto ${minimized ? "px-4 py-3" : "w-52 p-4"}`}>
      <div className={`flex items-center justify-between text-xs font-extrabold text-[#191c1d] ${minimized ? "gap-3" : "mb-2"}`}>
        <span>Map Legend</span>
        <button
          type="button"
          aria-label={minimized ? "Expand map legend" : "Minimize map legend"}
          aria-expanded={!minimized}
          onClick={toggle}
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
          <div className="border-t border-[#dfe8e2] pt-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-[#526359]">Indoor location types</span>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
              {([
                ["Room", "room"],
                ["Office", "office"],
                ["Laboratory", "laboratory"],
                ["Restroom", "restroom"],
              ] as const).map(([type, className]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={`indoor-map-legend-pin type-${className}`} aria-hidden="true">
                    <LocationTypeIcon type={type} size={13} />
                  </span>
                  <span>{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
