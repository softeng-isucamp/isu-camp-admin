import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { Location, RouteNode } from "../../types";
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
    buildings: vi.fn(async () => []),
    locations: vi.fn(async () => []),
    nodes: vi.fn(async () => []),
    pathways: vi.fn(async () => []),
    save: vi.fn(),
  } },
}));

describe("Map Editor preview", () => {
  it("reports that an unchanged map has no pending changes", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><MapEditor /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    expect(screen.getByText("No pending changes.")).toBeInTheDocument();
    view.unmount();
  });

  it("blocks a missing Route Node association and focuses its correction field", async () => {
    const location: Location = { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.975, lng: 121.731, positioned: true };
    const node: RouteNode = { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "missing-location", lat: 16.975, lng: 121.731 };
    vi.mocked(services.map.locations).mockResolvedValue([location]);
    vi.mocked(services.map.nodes).mockResolvedValue([node]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><MapEditor /></MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    const guidance = await screen.findByRole("button", { name: /Associated Location does not exist/ });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    fireEvent.click(guidance);

    await waitFor(() => expect(screen.getByLabelText("Associated Location")).toHaveFocus());
  });
});
