import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectionPopover, type ViewportBounds } from "./SelectionPopover";
import type { SelectionPopoverState } from "./useMapSelection";

const navigationBounds: [[number, number], [number, number]] = [[0, 0], [10, 10]];

function bounds(south: number, west: number, north: number, east: number): ViewportBounds {
  return { getSouth: () => south, getWest: () => west, getNorth: () => north, getEast: () => east };
}

function renderAt(anchor: [number, number], viewportBounds: ViewportBounds | null) {
  const popover = { anchor, candidates: [] } as unknown as SelectionPopoverState;
  render(<SelectionPopover popover={popover} navigationBounds={navigationBounds} viewportBounds={viewportBounds} onSelect={() => {}} />);
  return screen.getByRole("dialog", { name: "Choose overlapping object" });
}

// Viewport covers lat 4..6, lng 4..6 (a small slice of the campus bounds).
const viewport = bounds(4, 4, 6, 6);

describe("SelectionPopover placement", () => {
  it("opens below an anchor in the upper part of the viewport, using viewport fractions", () => {
    const dialog = renderAt([5.8, 5], viewport);

    expect(dialog).toHaveAttribute("data-placement", "below");
    expect(parseFloat(dialog.style.top)).toBeCloseTo(10, 5); // (6 - 5.8) / 2; navigationBounds would give 42%
    expect(dialog.style.left).toContain("50%");
  });

  it("opens above an anchor in the lower part of the viewport", () => {
    const dialog = renderAt([4.4, 5], viewport);

    expect(dialog).toHaveAttribute("data-placement", "above");
    expect(parseFloat(dialog.style.top)).toBeCloseTo(80, 5);
  });

  it("falls back to the navigation bounds without a viewport", () => {
    const dialog = renderAt([8, 5], null);

    expect(parseFloat(dialog.style.top)).toBeCloseTo(20, 5);
    expect(dialog).toHaveAttribute("data-placement", "below");
  });

  it("keeps the popover inside the map at the west edge", () => {
    const dialog = renderAt([5, 3], viewport);

    // jsdom mangles clamp() serialization, so only check the pieces: x clamped to 0%, bounded by 8.5rem margins.
    expect(dialog.style.left).toMatch(/^clamp\(/);
    expect(dialog.style.left).toContain("0%");
    expect(dialog.style.left.match(/8\.5rem/g)).toHaveLength(2);
  });
});
