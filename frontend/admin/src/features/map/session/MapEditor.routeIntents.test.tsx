import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import type { Pathway } from "../../../types";
import { MapEditor } from "../MapEditor";
import { useMapEditorTestLifecycle } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

const UrlProbe = () => {
  const location = useLocation();
  return <div data-testid="url">{location.pathname + location.search}</div>;
};

const renderWithClient = (entry: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <MapEditor />
        <UrlProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const refetch = () => act(async () => { await queryClient.invalidateQueries({ queryKey: ["map"] }); });
  return { refetch };
};

const library: Pathway = { id: "path-library", name: "Library Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] };

describe("Map Editor URL intents", () => {
  useMapEditorTestLifecycle();

  it("clears ?location= after locating a Building and does not re-select it on refetch", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Engineering Hall", code: "ENG", points: [[16.72, 121.689], [16.722, 121.689], [16.722, 121.691]] },
    ]);
    const { refetch } = renderWithClient("/map-editor?location=building-1");

    expect(await screen.findByRole("complementary", { name: "Engineering Hall object details" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent(/^\/map-editor$/));

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
    await refetch();
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears ?pathway= after opening it and does not reset the Pathway on refetch", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([{ ...library }]);
    const { refetch } = renderWithClient("/map-editor?pathway=path-library");

    expect(await screen.findByRole("heading", { name: "Calibrate Path Points" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent(/^\/map-editor$/));

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("heading", { name: "Calibrate Path Points" })).not.toBeInTheDocument();
    vi.mocked(services.map.pathways).mockResolvedValue([{ ...library, name: "Library Walk (renamed)" }]);
    await refetch();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "Calibrate Path Points" })).not.toBeInTheDocument();
  });

  it("clears ?pathway= when the Pathway is unavailable", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([]);
    renderWithClient("/map-editor?pathway=missing");

    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent(/^\/map-editor$/));
  });
});
