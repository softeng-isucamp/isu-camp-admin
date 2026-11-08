import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapSearchBox } from "./MapSearchBox";

// jsdom does not compute stacking, so layering is checked by the class that carries the z-index:
// the inspector card is z-index 901, an idle search box 900, and an open results list must be above 901.
const zIndexOf = (element: Element) => Number(/z-\[(\d+)\]/.exec(element.className)?.[1]);

describe("MapSearchBox", () => {
  const box = (results: { id: string; name: string; kind: "Location" }[]) => render(
    <MapSearchBox search="hall" results={results as never} onSearchChange={vi.fn()} onSelectResult={vi.fn()} />,
  ).container.firstElementChild!;

  it("stays below the inspector card layer while no results are listed", () => {
    expect(zIndexOf(box([]))).toBeLessThan(901);
  });

  it("lifts the open results list above the inspector card", () => {
    const wrapper = box([{ id: "r1", name: "Hall", kind: "Location" }]);
    expect(screen.getByRole("button", { name: /Hall/ })).toBeInTheDocument();
    expect(zIndexOf(wrapper)).toBeGreaterThan(901);
    expect(wrapper).toHaveClass("map-search-box-open");
  });
});
