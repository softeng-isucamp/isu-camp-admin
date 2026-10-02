import type { MapPoint } from "../campusBoundary";
import type { SelectionCandidate } from "../selectionCandidates";
import type { SelectionPopoverState } from "./useMapSelection";

/** The slice of a Leaflet LatLngBounds needed to place the popover. */
export interface ViewportBounds {
  getNorth: () => number;
  getSouth: () => number;
  getWest: () => number;
  getEast: () => number;
}

interface SelectionPopoverProps {
  popover: SelectionPopoverState;
  /** Fixed campus bounds, used until the live map viewport is known. */
  navigationBounds: [MapPoint, MapPoint];
  /** The map's current visible bounds. */
  viewportBounds: ViewportBounds | null;
  onSelect: (candidate: SelectionCandidate) => void;
}

const POPOVER_HALF_WIDTH = "8.5rem";
const ANCHOR_GAP = "12px";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function SelectionPopover({ popover, navigationBounds, viewportBounds, onSelect }: SelectionPopoverProps) {
  const south = viewportBounds?.getSouth() ?? navigationBounds[0][0];
  const west = viewportBounds?.getWest() ?? navigationBounds[0][1];
  const north = viewportBounds?.getNorth() ?? navigationBounds[1][0];
  const east = viewportBounds?.getEast() ?? navigationBounds[1][1];
  const [lat, lng] = popover.anchor;
  const x = clamp01((lng - west) / (east - west));
  const y = clamp01((north - lat) / (north - south));
  const placement = y < 0.5 ? "below" : "above";

  return (
    <div
      role="dialog"
      aria-label="Choose overlapping object"
      data-anchor={popover.anchor.join(",")}
      data-placement={placement}
      className="absolute z-[1100] w-64 rounded-2xl border border-[#dbe0e2] bg-white p-3 shadow-xl"
      style={{
        left: `clamp(${POPOVER_HALF_WIDTH}, ${x * 100}%, calc(100% - ${POPOVER_HALF_WIDTH}))`,
        top: `${y * 100}%`,
        transform: placement === "below" ? `translate(-50%, ${ANCHOR_GAP})` : `translate(-50%, calc(-100% - ${ANCHOR_GAP}))`,
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
