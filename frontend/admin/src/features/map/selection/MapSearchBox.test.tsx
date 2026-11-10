import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapSearchBox } from "./MapSearchBox";

// jsdom does not compute stacking, so layering is checked by the class that carries the z-index:
// the inspector card is z-index 901, an idle search box 900, and an open results list must be above 901.
const zIndexOf = (element: Element) => Number(/z-\[(\d+)\]/.exec(element.className)?.[1]);

describe("MapSearchBox", () => {
  const box = (results: { id: string; name: string; kind: "Location" }[], search = "hall") => render(
    <MapSearchBox search={search} results={results as never} onSearchChange={vi.fn()} onSelectResult={vi.fn()} />,
  ).container.firstElementChild!;

  it("stays below the inspector card layer while no results are listed", () => {
    expect(zIndexOf(box([], ""))).toBeLessThan(901);
  });

  it("lifts the open results list above the inspector card", () => {
    const wrapper = box([{ id: "r1", name: "Hall", kind: "Location" }]);
    expect(screen.getByRole("option", { name: /Hall/ })).toBeInTheDocument();
    expect(zIndexOf(wrapper)).toBeGreaterThan(901);
    expect(wrapper).toHaveClass("map-search-box-open");
  });

  describe("keyboard use", () => {
    const results = [
      { id: "r1", name: "Hall One", kind: "Location", type: "Place" },
      { id: "r2", name: "Hall Two", kind: "Location", type: "Place" },
    ];
    const open = (query = "hall") => {
      const onSelectResult = vi.fn();
      render(<MapSearchBox search={query} results={results as never} onSearchChange={vi.fn()} onSelectResult={onSelectResult} />);
      return { onSelectResult, input: screen.getByRole("combobox", { name: "Search campus places" }) };
    };

    it("exposes a listbox of options tied to the input", () => {
      const { input } = open();
      expect(input).toHaveAttribute("aria-expanded", "true");
      expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("moves with the arrow keys, wraps, and picks with Enter", () => {
      const { input, onSelectResult } = open();
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /Hall One/ })).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /Hall One/ }).id);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /Hall One/ })).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(screen.getByRole("option", { name: /Hall Two/ })).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ id: "r2" }));
    });

    it("picks nothing on Enter until an option is highlighted", () => {
      const { input, onSelectResult } = open();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelectResult).not.toHaveBeenCalled();
    });

    it("closes the list on Escape without letting the map's Escape handling see it", () => {
      const onWindowKey = vi.fn();
      window.addEventListener("keydown", onWindowKey);
      const { input } = open();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(onWindowKey).not.toHaveBeenCalled();
      // With the list already closed, Escape is left for the map.
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onWindowKey).toHaveBeenCalledTimes(1);
      window.removeEventListener("keydown", onWindowKey);
    });
  });

  it("says when no place matches the query", () => {
    render(<MapSearchBox search="zzz" results={[]} onSearchChange={vi.fn()} onSelectResult={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent('No places match "zzz"');
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
