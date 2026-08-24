import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { generatedMapFixture } from "../../services/generatedMapFixture";
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
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]),
    nodes: vi.fn(async () => [
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.69 },
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
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.69 },
    ]);
    vi.mocked(services.map.buildings).mockResolvedValue([]);
    vi.mocked(services.map.pathways).mockResolvedValue([]);
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

  it("loads the generated OSM fixture and keeps boundary safeguards active", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue(generatedMapFixture.buildings);
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Main Library" } });
    expect(await screen.findByRole("button", { name: /Main Library Location/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place" }));
    clickMap(16.8, 121.7);

    expect(screen.getByText("New or modified geometry must stay inside the ISU Echague campus boundary.")).toBeInTheDocument();
  });

  it("blocks a missing Route Node association and focuses its correction field", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "missing-location", lat: 16.7205, lng: 121.6895 },
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
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByDisplayValue("Main Library")).toBeInTheDocument();
    expect(screen.getByText("16.720800")).toBeInTheDocument();
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
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Node" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Node" }));
    clickMap(16.7212, 121.6905);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByDisplayValue("New Ramp")).toBeInTheDocument();
    expect(screen.getByText("16.721200")).toBeInTheDocument();
    expect(screen.getByText("121.690500")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7212,121.6905"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("New Ramp · node");
  });

  it("persists a seeded Route Node's moved position", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move Node" }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByText("16.721400")).toBeInTheDocument();
    expect(screen.getByText("121.690800")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7214,121.6908"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("North Entrance · node");
  });

  it("saves an Area polygon as the named Building shown in Preview", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Area" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    const preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("added (1)");
    expect(preview).toHaveTextContent("Science Annex · building");
  });

  it("focuses Building code correction guidance for an invalid saved footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Science Annex", code: "", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    fireEvent.click(screen.getByRole("button", { name: /Building code is required/ }));

    await waitFor(() => expect(screen.getByLabelText("Building code")).toHaveFocus());
  });

  it("focuses Building name correction guidance for an invalid saved footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "", code: "SCI-ANN", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    fireEvent.click(screen.getByRole("button", { name: /Building name is required/ }));

    await waitFor(() => expect(screen.getByLabelText("Building name")).toHaveFocus());
  });

  it("blocks malformed Building geometry in the review", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Science Annex", code: "SCI-ANN", points: [[16.720, 121.689], [16.721, 121.689], [16.720, 121.689]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));

    expect(screen.getByRole("button", { name: /Building geometry requires at least 3 distinct points/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("adjusts a selected Path Point with coordinates and preserves it in Preview", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    fireEvent.click(screen.getByRole("button", { name: "Path" }));
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.6899" } });
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6899],[16.721,121.69]]");
    fireEvent.click(screen.getByRole("button", { name: "Save Path" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6899],[16.721,121.69]]");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("North Walk · pathway");
  });

  it("moves a selected Path Point only when manual drag mode is enabled", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    fireEvent.click(screen.getByRole("button", { name: "Path" }));
    const point = await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" });
    fireEvent.click(point);
    expect(point).toHaveAttribute("data-draggable", "false");
    fireEvent.click(screen.getByRole("button", { name: "Drag Path Point" }));
    pathPointDragPosition = { lat: 16.7208, lng: 121.6898 };
    fireEvent.dragEnd(screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7208,121.6898],[16.721,121.69]]");
  });
});
