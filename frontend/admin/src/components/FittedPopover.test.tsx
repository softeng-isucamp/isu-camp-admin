import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FittedPopover } from "./FittedPopover";

type Box = { left: number; top: number; width: number; height: number };
const rect = ({ left, top, width, height }: Box) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** Lays out the card, the anchor and the popover (in its default place) at the given boxes, in a 1000×700 viewport. */
function layout(boxes: { card?: Box; anchor: Box; popover: Box }) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("card")) return rect(boxes.card ?? { left: 0, top: 0, width: 1000, height: 700 });
    if (this.dataset.anchor !== undefined) return rect(boxes.anchor);
    if (this.getAttribute("role") === "menu") return rect(boxes.popover);
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
}

const renderPopover = () => {
  render(
    <div className="card">
      <div data-anchor="">
        <FittedPopover className="row-action-menu" role="menu">Options</FittedPopover>
      </div>
    </div>,
  );
  return screen.getByRole("menu");
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FittedPopover", () => {
  it("keeps the default place when it fits", () => {
    layout({ anchor: { left: 100, top: 100, width: 160, height: 46 }, popover: { left: 100, top: 152, width: 280, height: 200 } });
    expect(renderPopover()).toHaveClass("row-action-menu");
    expect(screen.getByRole("menu")).not.toHaveClass("aligns-end");
    expect(screen.getByRole("menu")).not.toHaveClass("opens-up");
  });

  it("opens leftward when it would run past the right edge of the viewport", () => {
    layout({ anchor: { left: 820, top: 100, width: 160, height: 46 }, popover: { left: 820, top: 152, width: 280, height: 200 } });
    expect(renderPopover()).toHaveClass("aligns-end");
  });

  it("opens leftward when it would hang past its card, even with room on screen", () => {
    layout({
      card: { left: 0, top: 0, width: 900, height: 300 },
      anchor: { left: 700, top: 100, width: 160, height: 46 },
      popover: { left: 700, top: 152, width: 280, height: 200 },
    });
    expect(renderPopover()).toHaveClass("aligns-end");
  });

  it("opens upward when it would run past the bottom of the viewport and there is room above", () => {
    layout({ anchor: { left: 800, top: 620, width: 160, height: 62 }, popover: { left: 804, top: 688, width: 156, height: 94 } });
    expect(renderPopover()).toHaveClass("opens-up");
  });

  it("opens upward from a table's last row rather than cover the pagination under the table", () => {
    layout({
      card: { left: 0, top: 0, width: 1000, height: 500 },
      anchor: { left: 800, top: 400, width: 160, height: 62 },
      popover: { left: 804, top: 468, width: 156, height: 94 },
    });
    render(
      <div className="card">
        <table><tbody><tr><td data-anchor="">
          <FittedPopover className="row-action-menu" role="menu">Options</FittedPopover>
        </td></tr></tbody></table>
      </div>,
    );
    expect(screen.getByRole("menu")).toHaveClass("opens-up");
  });

  it("lets a filter's list hang below its filter bar", () => {
    layout({
      card: { left: 0, top: 0, width: 1000, height: 120 },
      anchor: { left: 100, top: 300, width: 160, height: 46 },
      popover: { left: 100, top: 352, width: 280, height: 200 },
    });
    expect(renderPopover()).not.toHaveClass("opens-up");
  });

  it("stays below when there is no room above either", () => {
    layout({ anchor: { left: 800, top: 40, width: 160, height: 62 }, popover: { left: 804, top: 108, width: 156, height: 640 } });
    expect(renderPopover()).not.toHaveClass("opens-up");
  });
});
