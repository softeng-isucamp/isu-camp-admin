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
let movingPointDragPosition: { lat: number; lng: number } | undefined;

vi.mock("leaflet", () => {
  let iconId = 0;
  return { default: {
    divIcon: (options: { className?: string; iconSize?: [number, number] }) => ({ ...options, testId: ++iconId }),
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    point: (x: number, y: number) => ({ x, y }),
  } };
});
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, maxZoom }: { children: React.ReactNode; maxZoom?: number }) => <div data-testid="map-container" data-max-zoom={maxZoom}>{children}</div>,
  Marker: ({ position, eventHandlers, draggable, icon }: { position: [number, number]; eventHandlers?: { click?: () => void; dragstart?: () => void; drag?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void; dragend?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void }; draggable?: boolean; icon?: { className?: string; iconSize?: [number, number]; testId?: number } }) => typeof draggable === "boolean" && icon?.className === "path-point-icon selected"
    ? <button aria-label={`Path Point at ${position.join(",")}`} data-testid="path-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} data-icon-id={icon.testId} data-icon-size={icon.iconSize?.join(",")} onClick={eventHandlers?.click} onDrag={() => pathPointDragPosition && eventHandlers?.drag?.({ target: { getLatLng: () => pathPointDragPosition! } })} onDragEnd={() => pathPointDragPosition && eventHandlers?.dragend?.({ target: { getLatLng: () => pathPointDragPosition! } })} />
    : eventHandlers?.drag ? <button aria-label={`Move point at ${position.join(",")}`} data-testid="move-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} onClick={eventHandlers.click} onDragStart={eventHandlers.dragstart} onDrag={() => movingPointDragPosition && eventHandlers.drag?.({ target: { getLatLng: () => movingPointDragPosition! } })} onDragEnd={() => movingPointDragPosition && eventHandlers.dragend?.({ target: { getLatLng: () => movingPointDragPosition! } })} />
    : typeof draggable === "boolean" ? <button aria-label={`Path Point at ${position.join(",")}`} data-testid="path-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} onClick={eventHandlers?.click} onDragEnd={() => pathPointDragPosition && eventHandlers?.dragend?.({ target: { getLatLng: () => pathPointDragPosition! } })} /> : eventHandlers ? <button aria-label={`Map marker at ${position.join(",")}`} data-testid="saved-map-marker" data-icon-class={icon?.className} data-position={position.join(",")} onClick={eventHandlers.click} /> : null,
  Polygon: ({ eventHandlers, pathOptions }: { eventHandlers?: { click?: () => void }; pathOptions?: { className?: string } }) => <button aria-label={pathOptions?.className ?? "building polygon"} onClick={eventHandlers?.click} />,
  Polyline: ({ positions, pathOptions, children, eventHandlers }: { positions: [number, number][]; pathOptions?: { className?: string }; children?: React.ReactNode; eventHandlers?: { click?: () => void } }) => <output data-testid={pathOptions?.className === "point-move-tether" ? "point-move-tether" : pathOptions?.className?.startsWith("local-feature-") ? "local-feature-line" : "path-geometry"} data-positions={JSON.stringify(positions)} onClick={eventHandlers?.click}>{children}</output>,
  Popup: () => null,
  TileLayer: ({ attribution }: { attribution: string }) => <div aria-label="Map attribution">{attribution}</div>, Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMap: () => ({
    flyTo: vi.fn(),
    latLngToContainerPoint: ({ lat, lng }: { lat: number; lng: number }) => ({ x: lng * 100_000, y: lat * 100_000 }),
    containerPointToLatLng: ({ x, y }: { x: number; y: number }) => ({ lat: y / 100_000, lng: x / 100_000 }),
  }),
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
    movingPointDragPosition = undefined;
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

  it("switches drawing tools from a minimizable command dock without losing the active mode", async () => {
    renderEditor();

    const polygonTool = await screen.findByRole("button", { name: "Building Polygon" });
    fireEvent.click(polygonTool);

    expect(polygonTool).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "Building Polygon guidance" })).toHaveTextContent(
      "Esc",
    );

    fireEvent.click(screen.getByRole("button", { name: "Minimize map command dock" }));

    const minimizedDock = screen.getByRole("button", { name: "Expand map command dock" });
    expect(minimizedDock).toHaveTextContent("Building Polygon");

    fireEvent.click(minimizedDock);
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    expect(screen.queryByRole("button", { name: "Local Feature" })).not.toBeInTheDocument();
  });

  it("retires a Building Footprint without deleting its Building from Locations", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();

    const buildingPolygon = await screen.findByRole("button", { name: "building polygon" });
    fireEvent.click(buildingPolygon);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering Hall" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Retire Footprint" }));

    expect(screen.getByRole("alert", { name: "Retired Local Map Feature" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    expect(buildingPolygon).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "⎌ Restore Feature" }));
    fireEvent.click(buildingPolygon);
    expect(screen.getByRole("complementary", { name: "Engineering Hall object details" })).toBeInTheDocument();
  });

  it("keeps an interrupted polygon draft on the suspended shelf and resumes it", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    const firstPrompt = screen.getByRole("dialog", { name: "Switch to Pathway?" });
    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));

    expect(firstPrompt).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));

    expect(screen.getByRole("button", { name: "Pathway" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    const shelf = screen.getByRole("dialog", { name: "Suspended Drafts" });
    expect(shelf).toHaveTextContent("Building Polygon draft");

    fireEvent.click(screen.getByRole("button", { name: "Resume Building Polygon draft" }));
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Points plotted: 1")).toBeInTheDocument();
  });

  it("uses Escape to cancel an incomplete drawing without retaining discarded geometry", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Switch to Select?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard Geometry" }));

    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Suspended Drafts/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    expect(screen.getByText("Points plotted: 0")).toBeInTheDocument();
  });

  it("restores the complete Point Location form when resuming a suspended draft", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Route Node" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Junction" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "Library Junction" } });
    clickMap(16.7208, 121.6902);

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));

    fireEvent.click(screen.getByRole("button", { name: "Point Location" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Route Node" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Access Point" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "Temporary Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));

    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume Point Location draft" }));

    expect(screen.getAllByRole("combobox")[0]).toHaveValue("Route Node");
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("Junction");
    expect(screen.getByPlaceholderText("e.g. CAS Entrance")).toHaveValue("Library Junction");
  });

  it("restores the selected Path Point and drag mode when resuming a suspended pathway", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();

    await screen.findByTestId("path-geometry");
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Drag Path Point" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));
    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume Pathway draft" }));

    expect(screen.getByRole("button", { name: "Stop Dragging" })).toBeInTheDocument();
    expect(screen.getByLabelText("Path Point latitude")).toHaveValue(16.7209);
  });

  it("reports that an unchanged map has no pending changes", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    expect(screen.getByText("No pending changes.")).toBeInTheDocument();
  });

  it("offers an anchored candidate popover for overlapping spatial features", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    const overlappingMarkers = await screen.findAllByRole("button", { name: "Map marker at 16.7205,121.6895" });
    fireEvent.click(overlappingMarkers[0]);

    const popover = screen.getByRole("dialog", { name: "Choose overlapping feature" });
    expect(popover).toHaveTextContent("Library");
    expect(popover).toHaveTextContent("Library Entrance");
    expect(popover).toHaveAttribute("data-anchor", "16.7205,121.6895");

    fireEvent.click(screen.getByRole("button", { name: "Select Library Entrance Route Node" }));
    expect(screen.getByRole("complementary", { name: "Library Entrance object details" })).toBeInTheDocument();
  });

  it("deselects the inspected feature when the administrator clicks empty canvas", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    expect(screen.getByRole("complementary", { name: "Library object details" })).toBeInTheDocument();

    clickMap(16.7208, 121.6902);

    expect(screen.queryByRole("complementary", { name: "Library object details" })).not.toBeInTheDocument();
  });

  it("credits OSM fixture overlays while using satellite tiles", async () => {
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Satellite" }));

    expect(screen.getByLabelText("Map attribution")).toHaveTextContent("Esri");
    expect(screen.getByLabelText("Map attribution")).toHaveTextContent("OpenStreetMap contributors");
  });

  it("loads the generated OSM fixture and keeps boundary safeguards active", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue(generatedMapFixture.buildings);
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Main Library" } });
    expect(await screen.findByRole("button", { name: /Main Library Location/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Point Location" }));
    clickMap(16.8, 121.7);

    expect(screen.getByText("New or modified geometry must stay inside the ISU Echague campus boundary.")).toBeInTheDocument();
  });

  it("moves an imported route node from the generated fixture", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue(generatedMapFixture.buildings);
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    const importedNode = generatedMapFixture.nodes[0];
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: importedNode.name } });
    fireEvent.click(await screen.findByRole("button", { name: `${importedNode.name} Route Node` }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));

    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent(`${importedNode.name} · node`);
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
  });

  it("edits an imported pathway from the generated fixture", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: generatedMapFixture.pathways[0].name } });
    fireEvent.click((await screen.findAllByRole("button", { name: `${generatedMapFixture.pathways[0].name} Pathway` }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "⌁ Reshape Pathway" }));
    const importedPoint = generatedMapFixture.pathways[0].pathPoints[0];
    fireEvent.click((await screen.findAllByRole("button", { name: `Path Point at ${importedPoint.join(",")}` }))[0]);
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.72095" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.6895" } });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Save Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));

    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent(`${generatedMapFixture.pathways[0].name} · pathway`);
  });

  it("retains building geometry validation for an imported building", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { ...generatedMapFixture.buildings[0], points: [generatedMapFixture.buildings[0].points[0], generatedMapFixture.buildings[0].points[1], generatedMapFixture.buildings[0].points[0]] },
      ...generatedMapFixture.buildings.slice(1),
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));

    expect(screen.getByRole("button", { name: /Building geometry requires at least 3 distinct points/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });

  it("blocks a missing Route Node association and focuses its correction field", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "missing-location", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    const guidance = await screen.findByRole("button", { name: /Associated Building does not exist/ });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    fireEvent.click(guidance);

    await waitFor(() => expect(screen.getByLabelText("Associated Building")).toHaveFocus());
  });

  it("preserves a Location rename when its marker position is saved afterwards", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Library" } });
    fireEvent.change(screen.getByRole("textbox", { name: /DESCRIPTION/ }), { target: { value: "Campus library services" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
    expect(screen.getByText("16.720800")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("renamed (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Main Library · location");
  });

  it("persists a newly added Route Node's moved position", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Route Node" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Ramp" } });
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Node" }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));
    clickMap(16.7212, 121.6905);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByRole("complementary", { name: "New Ramp object details" })).toBeInTheDocument();
    expect(screen.getByText("16.721200")).toBeInTheDocument();
    expect(screen.getByText("121.690500")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7212,121.6905"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("New Ramp · node");
  });

  it("opens the new location modal with the coordinates from a Place-mode map click", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    clickMap(16.7208, 121.6902);

    expect(screen.getByRole("dialog", { name: "Create Outdoor Point Location" })).toHaveTextContent(
      "Candidate position: 16.720800 · 121.690200",
    );
  });

  it("keeps a new outdoor point provisional until valid owner details are completed", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    clickMap(16.7208, 121.6902);

    expect(screen.getByText("Outdoor Point Location")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Building" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Room" })).not.toBeInTheDocument();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Outdoor Point Location" })).toBeDisabled();
  });

  it("creates one positioned canonical Location operation after valid outdoor details", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    clickMap(16.7208, 121.6902);
    fireEvent.change(screen.getByLabelText("New location name"), { target: { value: "Campus Flagpole" } });
    fireEvent.change(screen.getByLabelText("New location code"), { target: { value: "FLAGPOLE" } });
    fireEvent.change(screen.getByLabelText("New location description"), { target: { value: "Campus landmark" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Outdoor Point Location" }));

    expect(screen.getByRole("complementary", { name: "Campus Flagpole object details" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Campus Flagpole · location");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("added (1)");
  });

  it("edits Location details from the object card and records a Working Session operation", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Campus library services" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));

    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("[Locations]");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("does not render imported local map features", async () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: "local-feature-feat-poly-water-pond-01" })).not.toBeInTheDocument();
    expect(screen.queryByText("Campus Aquaculture Lagoon")).not.toBeInTheDocument();
  });

  it("persists a seeded Route Node's moved position", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    expect(screen.getByText("16.721400")).toBeInTheDocument();
    expect(screen.getByText("121.690800")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7214,121.6908"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("moved (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("North Entrance · node");
  });

  it("moves a point through the precision HUD with nudging, commit, and cancel", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));

    const moveHud = screen.getByRole("region", { name: "Move Library" });
    expect(screen.getByLabelText("Move latitude")).toHaveValue(16.7205);
    expect(screen.getByLabelText("Move longitude")).toHaveValue(121.6895);
    expect(moveHud).toHaveTextContent("Arrow keys 0.5m");

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(Number((screen.getByLabelText("Move latitude") as HTMLInputElement).value)).toBeGreaterThan(16.7205);
    expect(moveHud).toHaveTextContent("Δ 0.5m");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Move Library" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("16.720500");

    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));
    fireEvent.focus(screen.getByLabelText("Move latitude"));
    fireEvent.change(screen.getByLabelText("Move latitude"), { target: { value: "16.72" } });
    expect(screen.getByLabelText("Move latitude")).toHaveValue(16.72);
    fireEvent.change(screen.getByLabelText("Move latitude"), { target: { value: "16.720800" } });
    fireEvent.change(screen.getByLabelText("Move longitude"), { target: { value: "121.690200" } });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("16.720800");
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("121.690200");
  });

  it("renders direct drag feedback, snaps within 18px, and blocks an out-of-bound drop", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));

    const marker = screen.getByTestId("move-point-marker");
    movingPointDragPosition = { lat: 16.7207, lng: 121.68982 };
    fireEvent.dragStart(marker);
    fireEvent.drag(marker);

    expect(screen.getByRole("region", { name: "Move Library" })).toHaveTextContent("(Snapped)");
    expect(screen.getByLabelText("Move longitude")).toHaveValue(121.6897);
    expect(screen.getByTestId("point-move-tether")).toHaveAttribute(
      "data-positions",
      JSON.stringify([[16.7205, 121.6895], [16.7207, 121.6897]]),
    );
    expect(screen.getByTestId("point-move-tether-badge")).toHaveTextContent("Δ 30.8m (Snapped)");

    movingPointDragPosition = { lat: 16.8, lng: 121.7 };
    fireEvent.drag(marker);
    expect(screen.getByRole("alert")).toHaveTextContent("outside the ISU Echague Campus Boundary");
    expect(screen.getByRole("button", { name: "Save Position" })).toBeDisabled();
    expect(screen.getByTestId("move-point-marker")).toHaveAttribute("data-position", "16.8,121.7");

    fireEvent.dragEnd(screen.getByTestId("move-point-marker"));
    expect(screen.getByRole("alert")).toHaveTextContent("Point drop was blocked");
    expect(screen.getByRole("button", { name: "Save Position" })).toBeEnabled();
    expect(screen.getByTestId("move-point-marker")).toHaveAttribute("data-position", "16.7207,121.6897");
  });

  it("unpositions Outdoor Locations and cascades Route Node deletion to connected Pathways", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "⎋ Remove Position" }));
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("Not positioned");

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for North Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Deactivate Route Node" }));

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    expect(screen.queryAllByRole("button", { name: "North Walk Pathway" })).toHaveLength(0);
  });

  it("undoes and redoes Route Node deactivation with connected Pathways as one operation", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for North Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Deactivate Route Node" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");
    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "North Walk Pathway" }))[0]);
    expect(screen.getByRole("complementary", { name: "North Walk object details" })).toHaveTextContent("Two-way · Open");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    expect(screen.queryAllByRole("button", { name: "North Walk Pathway" })).toHaveLength(0);
  });

  it("saves an Area polygon as the named Building shown in Preview", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    expect(Array.from(document.querySelectorAll('[data-testid="saved-map-marker"]')).some((marker) =>
      marker.getAttribute("data-position")?.startsWith("16.720666"),
    )).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    const preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("added (2)");
    expect(preview).toHaveTextContent("Science Annex · building");
  });

  it("closes a Building Footprint from V1 without showing a separate closure overlay", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.72,121.689"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move point at 16.72,121.689" }));
    clickMap(16.720, 121.690);

    expect(screen.getByText("Points plotted: 3")).toBeInTheDocument();
  });

  it("opens Create-or-Attach when a footprint closes and preserves its geometry across tabs", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Move point at 16.72,121.689" }));

    expect(screen.getByRole("region", { name: "Create or attach building record" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "★ Create New Record" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-testid="move-point-marker"]').length).toBe(3);

    fireEvent.click(screen.getByRole("tab", { name: "🔗 Attach Existing Record" }));

    expect(screen.getByRole("tab", { name: "🔗 Attach Existing Record" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-testid="move-point-marker"]').length).toBe(3);
  });

  it("shows attach eligibility reasons and attaches only an eligible Building", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-open", name: "Science Hall", code: "SCI", points: [] },
      { id: "building-linked", name: "University Gym", code: "GYM", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Move point at 16.72,121.689" }));
    fireEvent.click(screen.getByRole("tab", { name: "🔗 Attach Existing Record" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search existing Buildings" }), { target: { value: "i" } });

    expect(screen.getByRole("button", { name: /University Gym/ })).toBeDisabled();
    expect(screen.getByText("Already linked to footprint feat-poly-building-linked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Science Hall/ }));
    fireEvent.click(screen.getByRole("button", { name: "Attach Selected Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    expect(screen.getByRole("alert", { name: "Building is not routable" })).toBeInTheDocument();
  });

  it("creates the feature, Building, and link as one compound Working Session change", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Move point at 16.72,121.689" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    fireEvent.click(screen.getByRole("button", { name: "Create New Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Science Annex · building");
  });

  it("launches a guided Entrance Route Node draft for the completed Building", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Move point at 16.72,121.689" }));
    fireEvent.click(screen.getByRole("button", { name: "Create New Building" }));
    fireEvent.click(screen.getByRole("button", { name: "🚪 Add Entrance Route Node Now" }));

    expect(screen.getByRole("button", { name: "Point Location" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("Route Node");
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("Entrance");
    expect(screen.getByText("Associated Building: Science Annex")).toBeInTheDocument();
  });

  it("places an Entrance by map click and allows its coordinates to be edited manually", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Point Location" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Route Node" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "Science Annex Entrance" } });
    clickMap(16.7208, 121.6902);

    fireEvent.change(screen.getByLabelText("Placement latitude"), { target: { value: "16.7211" } });
    fireEvent.change(screen.getByLabelText("Placement longitude"), { target: { value: "121.6907" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Node" }));

    expect(screen.getByText("16.721100")).toBeInTheDocument();
    expect(screen.getByText("121.690700")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7211,121.6907"]')).toBeTruthy();
  });

  it("shows a building room directory and associated entrances in the inspector", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-room-test", name: "Engineering Hall", code: "ENG-HALL", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "room-204", name: "Room 204", code: "204", type: "Room", parentId: "building-room-test", building: "Engineering Hall", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "entrance-eng", name: "Main Entrance", nodeType: "Entrance", associatedPlaceId: "building-room-test", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));

    expect(screen.getByRole("region", { name: "Building room directory" })).toHaveTextContent("2nd Floor");
    expect(screen.getByRole("region", { name: "Building room directory" })).toHaveTextContent("Room 204");
    expect(screen.getByRole("region", { name: "Building entrances" })).toHaveTextContent("Main Entrance");
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
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.6899" } });
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6899],[16.721,121.69]]");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Save Pathway" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    const point = await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" });
    fireEvent.click(point);
    expect(point).toHaveAttribute("data-draggable", "false");
    fireEvent.click(screen.getByRole("button", { name: "✥ Drag Path Point" }));
    const draggablePoint = screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" });
    const iconIdBeforeDrag = draggablePoint.getAttribute("data-icon-id");
    expect(draggablePoint).toHaveAttribute("data-icon-size", "30,30");
    pathPointDragPosition = { lat: 16.7208, lng: 121.6898 };
    fireEvent.drag(draggablePoint);
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7208,121.6898],[16.721,121.69]]");
    expect(screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" })).toHaveAttribute("data-icon-id", iconIdBeforeDrag);
    fireEvent.dragEnd(screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7208,121.6898],[16.721,121.69]]");
  });

  it("blocks drawing a duplicate direct Pathway in either direction", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ New Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Map marker at 16.721,121.69" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Map marker at 16.7205,121.6895" })[1]);

    expect(screen.getByRole("alert")).toHaveTextContent("A direct Pathway already connects these Route Nodes.");
  });

  it("adds a midpoint Path Point without creating a Route Node", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByTestId("path-geometry"));
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Path Point on segment 1" }));

    expect(screen.getByRole("button", { name: /Path Point at 16\.72075.*121\.68975/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map marker at 16.721,121.69" })).toBeInTheDocument();
  });

  it("allows close pathway editing and uses the building-footprint midpoint handle", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "Short Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByTestId("path-geometry"));
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));

    expect(screen.getByTestId("map-container")).toHaveAttribute("data-max-zoom", "22");
    expect(screen.getAllByTestId("saved-map-marker").some((marker) =>
      marker.getAttribute("data-icon-class") === "polygon-split-handle"
    )).toBe(true);
  });

  it("prompts for a visual crossing and commits a Junction split as one Working Session change", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "A", nodeType: "Junction", lat: 16.72, lng: 121.689 },
      { id: "node-b", name: "B", nodeType: "Junction", lat: 16.722, lng: 121.691 },
      { id: "node-c", name: "C", nodeType: "Junction", lat: 16.72, lng: 121.691 },
      { id: "node-d", name: "D", nodeType: "Junction", lat: 16.722, lng: 121.689 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-ab", name: "A–B", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
      { id: "path-cd", name: "C–D", sourceNodeId: "node-c", destinationNodeId: "node-d", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    expect(await screen.findByRole("alert", { name: "Non-routable pathway crossing" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Junction & Split Pathway" }));
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Non-routable pathway crossing" })).not.toBeInTheDocument());
  });

  it("supports editing polygon draft with vertex removal, clear area, finish footprint, and cancel", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    expect(screen.getByText("Points plotted: 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Last Point" }));
    expect(screen.getByText("Points plotted: 2")).toBeInTheDocument();

    clickMap(16.721, 121.690);
    expect(screen.getByText("Points plotted: 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish Footprint" }));
    expect(screen.getByText("Create or Attach Building")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "▱ Edit Shape" }));
    expect(screen.getByText("Draw Building Footprint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear Area" }));
    expect(screen.getByText("Points plotted: 0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Draw Building Footprint")).not.toBeInTheDocument();
  });

  it("collects descriptive fields and creates compound batch in correct order with null outdoor coordinates", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Finish Footprint" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Engineering Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "ENG-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Classrooms and Laboratories" } });
    fireEvent.change(screen.getByLabelText("Building keywords"), { target: { value: "engineering, labs" } });

    expect(screen.getAllByText(/Derived label anchor:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no copied outdoor coordinate stored on Building/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create New Building" }));
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("shows advisory overlap warning when polygon overlaps an existing building without blocking save", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "bld-existing", name: "Existing Hall", code: "EXT-01", points: [[16.720, 121.689], [16.722, 121.689], [16.722, 121.691], [16.720, 121.691]] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.721, 121.690);
    clickMap(16.723, 121.690);
    clickMap(16.723, 121.692);

    expect(screen.getByText(/Advisory: Footprint overlaps with Existing Hall/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish Footprint" }));
    expect(screen.getByText(/Advisory: Footprint overlaps with Existing Hall/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "New Overlapping Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "NOH-01" } });

    const saveBtn = screen.getByRole("button", { name: "Create New Building" });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("attaches footprint to eligible existing building without creating new location record", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "bld-eligible", name: "Eligible Building", code: "ELIG-01", points: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Finish Footprint" }));
    fireEvent.click(screen.getByRole("tab", { name: /Attach Existing Record/i }));

    expect(screen.getByText("Eligible Building · ELIG-01")).toBeInTheDocument();
    expect(screen.getByText("Eligible")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Eligible Building · ELIG-01"));
    fireEvent.click(screen.getByRole("button", { name: "Attach Selected Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    const preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("Eligible Building · building");
    expect(preview).not.toHaveTextContent("Eligible Building · location");
  });

  it("suspends and restores polygon draft with all fields preserved", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Finish Footprint" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Suspended Building" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SUSP-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Administration" } });
    fireEvent.change(screen.getByLabelText("Building keywords"), { target: { value: "admin, office" } });

    // Switch to pathway tool to trigger suspend modal
    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    expect(screen.getByRole("dialog", { name: "Switch to Pathway?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));
    expect(screen.getByRole("button", { name: "Pathway" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume Building Polygon draft" }));
    expect(screen.getByLabelText("Building name")).toHaveValue("Suspended Building");
    expect(screen.getByLabelText("Building code")).toHaveValue("SUSP-01");
    expect(screen.getByLabelText("Building function")).toHaveValue("Administration");
    expect(screen.getByLabelText("Building keywords")).toHaveValue("admin, office");
  });
});
