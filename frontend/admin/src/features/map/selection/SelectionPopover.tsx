import type { MapPoint } from "../campusBoundary";
import type { SelectionCandidate } from "../selectionCandidates";
import type { SelectionPopoverState } from "./useMapSelection";

interface SelectionPopoverProps {
  popover: SelectionPopoverState;
  navigationBounds: [MapPoint, MapPoint];
  onSelect: (candidate: SelectionCandidate) => void;
}

export function SelectionPopover({ popover, navigationBounds, onSelect }: SelectionPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label="Choose overlapping object"
      data-anchor={popover.anchor.join(",")}
      className="absolute z-[1100] w-64 -translate-x-1/2 -translate-y-full rounded-2xl border border-[#dbe0e2] bg-white p-3 shadow-xl"
      style={{
        left: `${Math.max(8, Math.min(92, ((popover.anchor[1] - navigationBounds[0][1]) / (navigationBounds[1][1] - navigationBounds[0][1])) * 100))}%`,
        top: `${Math.max(8, Math.min(92, (1 - (popover.anchor[0] - navigationBounds[0][0]) / (navigationBounds[1][0] - navigationBounds[0][0])) * 100))}%`,
        maxHeight: "min(50vh, 420px)",
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <p className="mb-2 text-xs font-bold text-[#191c1d]">Choose an object</p>
      <div className="flex flex-col gap-1">
        {popover.candidates.map((candidate) => (
          <button
            key={candidate.type === "location"
              ? `${candidate.type}-${candidate.locationType}-${candidate.id}`
              : `${candidate.type}-${candidate.id}`}
            type="button"
            aria-label={`Select ${candidate.label} ${candidate.kindLabel}`}
            className="rounded-xl px-3 py-2 text-left text-xs hover:bg-[#edf3ef]"
            onClick={() => onSelect(candidate)}
          >
            <strong className="block">{candidate.label}</strong>
            <span className="text-[#59645e]">{candidate.kindLabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
