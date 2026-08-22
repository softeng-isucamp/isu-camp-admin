import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MapEditor } from "./MapEditor";

vi.mock("leaflet", () => ({ default: { divIcon: () => ({}) } }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Marker: () => null, Polygon: () => null, Polyline: () => null, Popup: () => null,
  TileLayer: () => null, Tooltip: () => null,
  useMap: () => ({ flyTo: vi.fn() }), useMapEvents: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  setMockFailure: vi.fn(),
  services: { map: {
    buildings: async () => [],
    locations: async () => [],
    nodes: async () => [],
    pathways: async () => [],
    save: vi.fn(),
  } },
}));

describe("Map Editor preview", () => {
  it("reports that an unchanged map has no pending changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><MapEditor /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    expect(screen.getByText("No pending changes.")).toBeInTheDocument();
  });
});
