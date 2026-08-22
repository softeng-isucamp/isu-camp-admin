import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { services } from "/home/jade/dev/projects/isu-camp/frontend/admin/src/services/api";
import { MapEditor } from "/home/jade/dev/projects/isu-camp/frontend/admin/src/features/map/MapEditor";

vi.mock("leaflet", () => ({ default: { divIcon: () => ({}) } }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="mapcontainer">{children}</div>,
  Marker: ({ position }: { position: [number, number] }) => <div>marker {position.join(",")}</div>,
  Polygon: () => null,
  Polyline: ({ positions }: { positions: [number, number][] }) => <output data-testid="path-geometry" data-positions={JSON.stringify(positions)} />,
  Popup: () => null, TileLayer: () => null, Tooltip: () => null,
  useMap: () => ({ flyTo: vi.fn() }), useMapEvents: () => ({}),
}));
vi.mock("../../services/api", () => ({
  setMockFailure: vi.fn(),
  services: { map: {
    buildings: async () => [],
    locations: async () => [],
    nodes: async () => [
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.975, lng: 121.731 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.976, lng: 121.732 },
    ],
    pathways: async () => [
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.9755, 121.7315]] },
    ],
    save: vi.fn(),
  } },
}));

describe("debug", () => {
  it("shows polyline", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><MemoryRouter><MapEditor /></MemoryRouter></QueryClientProvider>);
    await screen.findAllByText(/marker/);
    expect(screen.getByTestId("path-geometry")).toBeTruthy();
  });
});
