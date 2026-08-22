import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { Location, RouteNode } from "../../types";
import { MapEditor } from "./MapEditor";

let mapClickHandler: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;
let pathPointDragPosition: { lat: number; lng: number } | undefined;

vi.mock("leaflet", () => ({ default: { divIcon: () => ({}) } }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ position, eventHandlers, draggable }: { position: [number, number]; eventHandlers?: { click?: () => void; dragend?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void }; draggable?: boolean }) => typeof draggable === "boolean" ? <button aria-label={`Path Point at ${position.join(",")}`} data-testid="path-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} onClick={eventHandlers?.click} onDragEnd={() => pathPointDragPosition && eventHandlers?.dragend?.({ target: { getLatLng: () => pathPointDragPosition! } })} /> : eventHandlers ? <div data-testid="saved-map-marker" data-position={position.join(",")} /> : null,
  Polygon: () => null, Polyline: ({ positions }: { positions: [number, number][] }) => <output data-testid="path-geometry" data-positions={JSON.stringify(positions)} />, Popup: () => null,
  TileLayer: () => null, Tooltip: () => null,
  useMap: () => ({ flyTo: vi.fn() }),
  useMapEvents: ({ click }: { click: (event: { latlng: { lat: number; lng: number } }) => void }) => {
    mapClickHandler = click;
  },
}));
vi.mock("../../services/api", () => ({
  setMockFailure: vi.fn(),
  services: { map: {
    buildings: vi.fn(async () => []),
    locations: vi.fn(async () => [
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.975, lng: 121.731, positioned: true },
    ]),
    nodes: vi.fn(async () => [
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.975, lng: 121.731 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.976, lng: 121.732 },
    ]),
    pathways: vi.fn(async () => []),
    save: vi.fn(),
  } },
}));

describe("Map Editor preview", () => {
  beforeEach(() => {
    mapClickHandler = undefined;
    pathPointDragPosition = undefined;
    vi.mocked(services.map.buildings).mockResolvedValue([]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.975, lng: 121.731, positioned: true },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.975, lng: 121.731 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.976, lng: 121.732 },
    ]);
  });
  afterEach(cleanup);

  const renderEditor = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={queryClient}><MemoryRouter><MapEditor /></MemoryRouter></QueryClientProvider>);
  };

  const clickMap = (lat: number, lng: number) => {
    act(() => mapClickHandler?.({ latlng: { lat, lng } }));
  };

  it("reports that an unchanged map has no pending changes", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    expect(screen.getByText("No pending changes.")).toBeInTheDocument();
  });

  it("blocks a missing Route Node association and focuses its correction field", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "missing-location", lat: 16.975, lng: 121.731 },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    const guidance = await screen.findByRole("button", { name: /Associated Location does not exist/ });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    fireEvent.click(guidance);

    await waitFor(() => expect(screen.getByLabelText("Associated Location")).toHaveFocus());
  });

  it("preserves a Location rename when its marker position is saved afterwards", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Library" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Marker" }));
    clickMap(16.977, 121.733);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByDisplayValue("Main Library")).toBeInTheDocument();
    expect(screen.getByText("16.977000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("renamed (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Main Library · location");
  });

  it("persists a newly added Route Node's moved position", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Place" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Route Node" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Ramp" } });
    clickMap(16.977, 121.733);
    fireEvent.click(screen.getByRole("button", { name: "Save Node" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Node" }));
    clickMap(16.978, 121.734);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByDisplayValue("New Ramp")).toBeInTheDocument();
    expect(screen.getByText("16.978000")).toBeInTheDocument();
    expect(screen.getByText("121.734000")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.978,121.734"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("New Ramp · node");
  });

  it("persists a seeded Route Node's moved position", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move Node" }));
    clickMap(16.979, 121.735);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByText("16.979000")).toBeInTheDocument();
    expect(screen.getByText("121.735000")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.979,121.735"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("North Entrance · node");
  });

  it("saves an Area polygon as the named Building shown in Preview", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Area" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    clickMap(16.975, 121.731);
    clickMap(16.976, 121.731);
    clickMap(16.976, 121.732);
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    const preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("added (1)");
    expect(preview).toHaveTextContent("Science Annex · building");
  });

  it("focuses Building code correction guidance for an invalid saved footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Science Annex", code: "", points: [[16.975, 121.731], [16.976, 121.731], [16.976, 121.732]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    fireEvent.click(screen.getByRole("button", { name: /Building code is required/ }));

    await waitFor(() => expect(screen.getByLabelText("Building code")).toHaveFocus());
  });

  it("focuses Building name correction guidance for an invalid saved footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "", code: "SCI-ANN", points: [[16.975, 121.731], [16.976, 121.731], [16.976, 121.732]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    fireEvent.click(screen.getByRole("button", { name: /Building name is required/ }));

    await waitFor(() => expect(screen.getByLabelText("Building name")).toHaveFocus());
  });

  it("blocks malformed Building geometry in the review", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Science Annex", code: "SCI-ANN", points: [[16.975, 121.731], [16.976, 121.731], [16.975, 121.731]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));

    expect(screen.getByRole("button", { name: /Building geometry requires at least 3 distinct points/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("adjusts a selected Path Point with coordinates and preserves it in Preview", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.9755, 121.7315]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    fireEvent.click(screen.getByRole("button", { name: "Path" }));
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.9755,121.7315" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.9757" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.7317" } });
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.975,121.731],[16.9757,121.7317],[16.976,121.732]]");
    fireEvent.click(screen.getByRole("button", { name: "Save Path" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.975,121.731],[16.9757,121.7317],[16.976,121.732]]");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("North Walk · pathway");
  });

  it("moves a selected Path Point only when manual drag mode is enabled", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.9755, 121.7315]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    fireEvent.click(screen.getByRole("button", { name: "Path" }));
    const point = await screen.findByRole("button", { name: "Path Point at 16.9755,121.7315" });
    fireEvent.click(point);
    expect(point).toHaveAttribute("data-draggable", "false");
    fireEvent.click(screen.getByRole("button", { name: "Drag Path Point" }));
    pathPointDragPosition = { lat: 16.9758, lng: 121.7318 };
    fireEvent.dragEnd(screen.getByRole("button", { name: "Path Point at 16.9755,121.7315" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.975,121.731],[16.9758,121.7318],[16.976,121.732]]");
  });
});
