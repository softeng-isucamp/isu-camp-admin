import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { MapEditor } from "./MapEditor";

let mapClickHandler: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;

vi.mock("leaflet", () => ({
  default: {
    divIcon: (options: { className?: string }) => options,
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    point: (x: number, y: number) => ({ x, y }),
  },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  Marker: ({ position, eventHandlers, icon }: {
    position: [number, number];
    eventHandlers?: { click?: () => void };
    icon?: { className?: string };
  }) => <button aria-label={`Map marker at ${position.join(",")}`} data-testid="saved-map-marker" data-position={position.join(",")} data-icon-class={icon?.className} onClick={eventHandlers?.click} />,
  Polygon: ({ eventHandlers, pathOptions }: { eventHandlers?: { click?: () => void }; pathOptions?: { className?: string } }) => <button aria-label={pathOptions?.className ?? "building polygon"} onClick={eventHandlers?.click} />,
  Polyline: ({ positions, children }: { positions: [number, number][]; children?: React.ReactNode }) => <output data-testid="path-geometry" data-positions={JSON.stringify(positions)}>{children}</output>,
  Popup: () => null,
  TileLayer: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMap: () => ({ flyTo: vi.fn(), fitBounds: vi.fn(), latLngToContainerPoint: () => ({ x: 0, y: 0 }), containerPointToLatLng: () => ({ lat: 0, lng: 0 }) }),
  useMapEvents: ({ click }: { click: (event: { latlng: { lat: number; lng: number } }) => void }) => { mapClickHandler = click; },
}));

vi.mock("../../services/api", () => ({
  services: {
    map: {
      buildings: vi.fn(), locations: vi.fn(), nodes: vi.fn(), pathways: vi.fn(),
      removeBuilding: vi.fn(), createRouteNode: vi.fn(), updateRouteNode: vi.fn(), deleteRouteNode: vi.fn(),
      createPathway: vi.fn(), updatePathway: vi.fn(), deletePathway: vi.fn(), save: vi.fn(),
    },
    locations: { list: vi.fn(), save: undefined },
  },
}));

const library = { id: "building-library", name: "Library", code: "LIB", type: "Building" as const, parentId: null, status: "Active" as const, lat: 16.7205, lng: 121.6895, positioned: true };
const nodes = [
  { id: "node-a", name: "North Entrance", nodeType: "Entrance" as const, associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
  { id: "node-b", name: "South Junction", nodeType: "Junction" as const, associatedPlaceId: null, lat: 16.721, lng: 121.69 },
];
const northWalk = { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded" as const, type: "Walkway" as const, direction: "Two-way" as const, status: "Open" as const, pathPoints: [[16.7207, 121.6897] as [number, number]] };

describe("Map Editor tool-level persistence", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    mapClickHandler = undefined;
    vi.mocked(services.map.buildings).mockResolvedValue([]);
    vi.mocked(services.map.locations).mockResolvedValue([library]);
    vi.mocked(services.map.nodes).mockResolvedValue(nodes);
    vi.mocked(services.map.pathways).mockResolvedValue([]);
    vi.mocked(services.map.save).mockResolvedValue(undefined);
    vi.mocked(services.map.createRouteNode).mockImplementation(async (node) => ({ ...node, id: "created-node" }));
    vi.mocked(services.map.updateRouteNode).mockImplementation(async (node) => node);
    vi.mocked(services.map.createPathway).mockImplementation(async (pathway) => ({ ...pathway, id: "created-pathway" }));
    vi.mocked(services.map.updatePathway).mockImplementation(async (pathway) => pathway);
  });
  afterEach(cleanup);

  const renderEditor = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><MapEditor /></MemoryRouter></QueryClientProvider>);
  const clickMap = (lat: number, lng: number) => act(() => mapClickHandler?.({ latlng: { lat, lng } }));
  const selectSearchResult = async (name: string, kind: "Route Node" | "Pathway") => {
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: name } });
    fireEvent.click(await screen.findByRole("button", { name: `${name} ${kind}` }));
  };

  it("keeps map-wide save and discard visible but disabled", async () => {
    renderEditor();
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByText(/Map-wide save and discard are unavailable/)).toBeInTheDocument();
  });

  it("creates a Route Node only through Save Route Node and preserves its draft after a failed request", async () => {
    vi.mocked(services.map.createRouteNode).mockRejectedValueOnce(new Error("network unavailable"));
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node name"), { target: { value: "Library Gate" } });
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("network unavailable");
    expect(screen.getByLabelText("Route Node name")).toHaveValue("Library Gate");
    expect(screen.getByLabelText("Placement latitude")).toHaveValue(16.7208);

    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));
    await waitFor(() => expect(services.map.createRouteNode).toHaveBeenCalledTimes(2));
    expect(vi.mocked(services.map.createRouteNode).mock.calls[1][0]).toMatchObject({ name: "Library Gate", lat: 16.7208, lng: 121.6902 });
  });

  it("moves a Route Node through Save Position", async () => {
    renderEditor();
    await selectSearchResult("North Entrance", "Route Node");
    fireEvent.click(screen.getByRole("button", { name: /Move Entrance/ }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));
    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({ id: "node-a", lat: 16.7214, lng: 121.6908 })));
  });

  it("updates an Entrance Building association through Update Route Node", async () => {
    renderEditor();
    await selectSearchResult("North Entrance", "Route Node");
    fireEvent.change(screen.getByLabelText("Route Node association"), { target: { value: "building-library" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Route Node" }));
    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({ id: "node-a", nodeType: "Entrance", associatedPlaceId: "building-library" })));
  });

  it("updates Pathway metadata through Update Pathway", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([northWalk]);
    renderEditor();
    await selectSearchResult("North Walk", "Pathway");
    fireEvent.change(document.querySelector<HTMLInputElement>('input[aria-label="Pathway name"]')!, { target: { value: "Library Walk" } });
    fireEvent.change(document.querySelector<HTMLSelectElement>('select[aria-label="Pathway shade"]')!, { target: { value: "Fully Shaded" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Update Pathway" })[0]);
    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({ id: "path-1", name: "Library Walk", shade: "Fully Shaded" })));
  });

  it("retries a failed Pathway geometry save without losing the edited Path Point", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([northWalk]);
    vi.mocked(services.map.updatePathway).mockRejectedValueOnce(new Error("pathway unavailable"));
    renderEditor();
    await selectSearchResult("North Walk", "Pathway");
    fireEvent.click(screen.getByRole("button", { name: "⌁ Reshape Pathway" }));
    fireEvent.click(await screen.findByRole("button", { name: "Map marker at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Save Pathway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("pathway unavailable");
    expect(screen.getByLabelText("Path Point latitude")).toHaveValue(16.7209);
    const failedAttempts = vi.mocked(services.map.updatePathway).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Save Pathway" }));
    await waitFor(() => expect(services.map.updatePathway.mock.calls.length).toBeGreaterThan(failedAttempts));
    expect(vi.mocked(services.map.updatePathway).mock.calls.at(-1)?.[0]).toMatchObject({ id: "path-1", pathPoints: [[16.7209, 121.6897]] });
  });

  it("saves a reshaped Building footprint through its active tool and preserves the draft after failure", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([{ id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.72, 121.689], [16.721, 121.689], [16.721, 121.69]] }]);
    vi.mocked(services.map.save).mockRejectedValueOnce(new Error("footprint unavailable"));
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "▱ Reshape Footprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Update Building Footprint" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("footprint unavailable");
    expect(screen.getByRole("heading", { name: "Change Building Footprint" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Building Footprint" }));
    await waitFor(() => expect(services.map.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(services.map.save).mock.calls[1][0]).toMatchObject({ buildings: [expect.objectContaining({ id: "building-eng", points: [[16.72, 121.689], [16.721, 121.689], [16.721, 121.69]] })] });
  });
});
