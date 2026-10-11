import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapLoadingOverlay } from "./MapLoadingOverlay";
import type { MapLoad, MapLoadStage } from "./session/mapLoadProgress";

const stages = (...statuses: MapLoadStage["status"][]): MapLoadStage[] => [
  { key: "buildings", label: "Buildings" },
  { key: "locations", label: "Locations on map" },
  { key: "nodes", label: "Route Nodes" },
  { key: "pathways", label: "Pathways" },
  { key: "directory", label: "Locations directory" },
].map((stage, index) => ({ ...stage, key: stage.key as MapLoadStage["key"], status: statuses[index] ?? "pending" }));

const loading = (overrides: Partial<MapLoad> = {}): MapLoad => ({
  stages: stages("done", "done", "loading"),
  progress: 2 / 5,
  loaded: false,
  error: null,
  ...overrides,
});

const matchMedia = (reduced: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({
  matches: reduced && query.includes("prefers-reduced-motion"),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}));

const renderOverlay = (load: MapLoad, onRetry = vi.fn()) => {
  const view = render(<MapLoadingOverlay load={load} onRetry={onRetry} />);
  return { ...view, onRetry, root: () => view.container.firstElementChild as HTMLElement | null };
};

describe("MapLoadingOverlay", () => {
  beforeEach(() => matchMedia(true));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("names the stage in flight with its detail and the percentage", () => {
    renderOverlay(loading({
      stages: stages("done", "done", "done", "done", "loading").map((stage) =>
        stage.key === "directory" ? { ...stage, detail: "2 of 7 pages" } : stage),
      progress: 4 / 5,
    }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Locations directory");
    expect(status).toHaveTextContent("2 of 7 pages");
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Map data loading" })).toHaveAttribute("aria-valuenow", "80");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("covers the map and blocks pointer events while loading", () => {
    const { root } = renderOverlay(loading());

    expect(root()).toHaveAttribute("aria-busy", "true");
    expect(root()).not.toHaveClass("pointer-events-none");
  });

  it("turns into an alert with the error and a Retry button on failure", () => {
    const { onRetry } = renderOverlay(loading({
      stages: stages("done", "done", "done", "error"),
      error: "Pathways could not be loaded.",
    }));

    expect(screen.getByRole("alert")).toHaveTextContent("Pathways could not be loaded.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("returns to the loading display when a retry clears the error", () => {
    const { rerender, onRetry } = renderOverlay(loading({ error: "Down." }));
    rerender(<MapLoadingOverlay load={loading()} onRetry={onRetry} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows nothing when the data was already loaded on arrival", () => {
    const { container } = renderOverlay(loading({ stages: stages("done", "done", "done", "done", "done"), progress: 1, loaded: true }));

    expect(container).toBeEmptyDOMElement();
  });

  it("goes away at once under reduced motion when loading finishes", () => {
    const { rerender, container, onRetry } = renderOverlay(loading());

    rerender(<MapLoadingOverlay load={loading({ stages: stages("done", "done", "done", "done", "done"), progress: 1, loaded: true })} onRetry={onRetry} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("holds at 100%, fades and then unmounts when loading finishes", () => {
    matchMedia(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { rerender, root, onRetry } = renderOverlay(loading());

    rerender(<MapLoadingOverlay load={loading({ stages: stages("done", "done", "done", "done", "done"), progress: 1, loaded: true })} onRetry={onRetry} />);
    expect(root()).not.toHaveClass("pointer-events-none");
    expect(screen.getByRole("status")).toHaveTextContent("Map ready");

    act(() => { vi.advanceTimersByTime(450); });
    expect(root()).toHaveClass("opacity-0", "pointer-events-none");

    act(() => { vi.advanceTimersByTime(350); });
    expect(root()).toBeNull();
  });
});
