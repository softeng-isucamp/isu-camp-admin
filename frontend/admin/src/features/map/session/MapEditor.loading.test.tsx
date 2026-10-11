import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import type { Building } from "../../../types";
import { MapEditor } from "../MapEditor";
import { useMapEditorTestLifecycle, renderEditor } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const overlay = () => screen.queryByRole("progressbar", { name: "Map data loading" });

describe("Map Editor loading overlay", () => {
  useMapEditorTestLifecycle();
  beforeEach(() => {
    vi.mocked(services.map.pathways).mockClear();
    vi.mocked(services.map.locations).mockClear();
    vi.mocked(services.locations.list).mockClear();
  });

  it("covers the map with the stage in flight until the data resolves, then goes away", async () => {
    const buildings = deferred<Building[]>();
    vi.mocked(services.map.buildings).mockReturnValue(buildings.promise);
    renderEditor();

    expect(overlay()).toHaveAttribute("aria-valuenow", expect.stringMatching(/^\d+$/));
    expect(screen.getByRole("status")).toHaveTextContent("Buildings");
    expect(services.map.locations).not.toHaveBeenCalled();

    buildings.resolve([]);

    await waitFor(() => expect(overlay()).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a failed load with Retry, which reloads only what failed", async () => {
    vi.mocked(services.map.pathways).mockRejectedValueOnce(new Error("Pathways could not be loaded."));
    renderEditor();

    expect(await screen.findByRole("alert")).toHaveTextContent("Pathways could not be loaded.");
    expect(overlay()).toBeInTheDocument();
    expect(services.locations.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(overlay()).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(services.map.pathways).toHaveBeenCalledTimes(2);
    expect(services.locations.list).toHaveBeenCalledTimes(1);
  });

  it("does not appear for cached data, nor for a background refetch", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["map"], { buildings: [], locations: [], nodes: [], pathways: [] });
    queryClient.setQueryData(["locations", "map-directory"], []);
    const refetch = deferred<Building[]>();
    vi.mocked(services.map.buildings).mockReturnValue(refetch.promise);

    render(<QueryClientProvider client={queryClient}><MemoryRouter><MapEditor /></MemoryRouter></QueryClientProvider>);

    await waitFor(() => expect(services.map.buildings).toHaveBeenCalled());
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    refetch.resolve([]);
    await waitFor(() => expect(queryClient.isFetching({ queryKey: ["map"] })).toBe(0));
    expect(overlay()).not.toBeInTheDocument();
  });
});
