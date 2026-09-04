import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { generatedMapFixture } from "../../services/generatedMapFixture";
import type { SaveDraftCommand, WorkingOperation } from "../../services/mapEditorApiClient";
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
  Polyline: ({ positions, pathOptions, children, eventHandlers }: { positions: [number, number][]; pathOptions?: { className?: string; color?: string }; children?: React.ReactNode; eventHandlers?: { click?: () => void } }) => <output data-testid={pathOptions?.className === "point-move-tether" ? "point-move-tether" : pathOptions?.className?.startsWith("local-feature-") ? "local-feature-line" : "path-geometry"} data-positions={JSON.stringify(positions)} data-color={pathOptions?.color} onClick={eventHandlers?.click}>{children}</output>,
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
  services: {
    map: {
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
      saveDraft: undefined as unknown as typeof services.map.saveDraft,
    },
    locations: {
      list: vi.fn(async () => ({
        items: [
          { id: "loc-1", name: "Library", code: "LIB", type: "Facility" as const, parentId: null, status: "Active" as const, lat: 16.7205, lng: 121.6895, positioned: true },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      })),
      save: undefined as unknown as typeof services.locations.save,
    },
  },
}));

describe("Map Editor preview", () => {
  beforeEach(() => {
    mapClickHandler = undefined;
    pathPointDragPosition = undefined;
    movingPointDragPosition = undefined;
    services.map.saveDraft = undefined;
    services.locations.save = undefined as unknown as typeof services.locations.save;
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

  const renderEditor = (initialEntries = ["/map-editor"]) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}><MapEditor /></MemoryRouter></QueryClientProvider>);
  };

  const clickMap = (lat: number, lng: number) => {
    act(() => mapClickHandler?.({ latlng: { lat, lng } }));
  };

  it("switches drawing tools from a minimizable command dock without losing the active mode", async () => {
    renderEditor();

    const polygonTool = await screen.findByRole("button", { name: "Building Polygon" });
    fireEvent.click(polygonTool);

    expect(polygonTool).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("status", { name: "Building Polygon guidance" })).not.toBeInTheDocument();

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

  it("opens the requested creation tool from a Locations handoff", async () => {
    renderEditor(["/map-editor?create=building"]);
    expect(await screen.findByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses the point command only for Route Node creation", async () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: "Outdoor Point Location" })).not.toBeInTheDocument();
    const routeNodeTool = await screen.findByRole("button", { name: "Route Node" });
    fireEvent.click(routeNodeTool);
    clickMap(16.7208, 121.6902);

    expect(screen.getByRole("heading", { name: "Place Route Node" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Place Outdoor Point Location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create Outdoor Point Location" })).not.toBeInTheDocument();
  });

  it("keeps Walking Network browser selection synchronized with the map", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "120 m", time: "2 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
    const pathwayResult = await screen.findByRole("button", { name: /Library Walk/ });
    fireEvent.click(pathwayResult);
    expect(pathwayResult).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-color", "#e67e22");

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const nodeMarker = screen.getAllByTestId("saved-map-marker").find((marker) =>
      marker.getAttribute("data-icon-class")?.includes("route-node-icon") && marker.getAttribute("data-position") === "16.7205,121.6895",
    );
    fireEvent.click(nodeMarker!);
    const overlapChoice = await screen.findByRole("button", { name: "Select North Entrance Route Node" });
    fireEvent.click(overlapChoice);

    expect(screen.getByRole("tab", { name: "Route Nodes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: /North Entrance/ }).find((button) =>
      button.hasAttribute("aria-pressed"),
    )).toHaveAttribute("aria-pressed", "true");
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

  it("uses a geometry-only Change scope when reshaping an existing linked footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "▱ Reshape Footprint" }));

    expect(screen.getByRole("region", { name: "Change scope" })).toHaveTextContent(
      "only the linked Building Footprint geometry",
    );
    expect(screen.getByRole("region", { name: "Change scope" })).toHaveTextContent(
      "Building Campus Location and its details are unchanged",
    );
    expect(screen.getByRole("button", { name: "Open Building details ↗" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "★ Create New Building" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "🔗 Attach Existing Building" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Building name")).not.toBeInTheDocument();
  });

  it("saves an existing footprint change without changing the Building Campus Location", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    services.map.saveDraft = vi.fn(async (command: SaveDraftCommand) => ({
      success: true as const,
      newDraftVersion: command.baseDraftVersion + 1,
      updatedAt: new Date().toISOString(),
    }));
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "▱ Reshape Footprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply footprint change" }));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const saveButtons = screen.getAllByRole("button", { name: "Save Changes" });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(services.map.saveDraft).toHaveBeenCalledTimes(1));
    const [operation] = vi.mocked(services.map.saveDraft).mock.calls[0][0].operations;
    expect(operation).toMatchObject({ type: "update_geometry", domain: "Local Map Data" });
    expect(vi.mocked(services.map.saveDraft).mock.calls[0][0].operations.some((item) => item.domain === "Locations")).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Route Node" }));
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

  it.skip("blocks a missing Route Node association and focuses its correction field", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "missing-location", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Preview Map" }));
    const guidance = await screen.findByRole("button", { name: /Associated Building does not exist/ });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    fireEvent.click(guidance);

    await waitFor(() => expect(screen.getByLabelText("Associated Building")).toBeInTheDocument());
  });

  it("preserves a Location rename while mapped geometry remains read-only", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Library" } });
    fireEvent.change(screen.getByRole("textbox", { name: /DESCRIPTION/ }), { target: { value: "Campus library services" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("renamed (1)");
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Main Library · location");
  });

  it("persists a newly added Route Node's moved position", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Ramp" } });
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    expect(screen.getByRole("complementary", { name: "New Ramp object details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("New Ramp · node");
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

  it("records Route Node inspector edits and clears an Entrance association when changing type", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "loc-1", lat: 16.7205, lng: 121.6895 },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Building", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Entrance Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node name"), { target: { value: "North Gate" } });
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Junction" } });

    expect(screen.getByLabelText("Route Node name")).toHaveValue("North Gate");
    expect(screen.queryByLabelText("Route Node association")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(screen.getByRole("complementary", { name: "North Gate object details" })).toHaveTextContent("Junction Route Node");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("shows canonical Buildings for an Entrance association without persisting the selection", async () => {
    const saveDraft = vi.fn();
    services.map.saveDraft = saveDraft;
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "map-only-building", name: "Unregistered Map Shape", code: "MAP-ONLY", points: [] },
    ]);
    vi.mocked(services.locations.list).mockResolvedValue({
      items: [{ id: "building-42", name: "Engineering Hall", code: "ENG-01", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));

    const association = await screen.findByLabelText("Route Node association");
    expect(association).toHaveDisplayValue("No Building association");
    expect(within(association).getByRole("option", { name: "Engineering Hall (ENG-01)" })).toBeInTheDocument();
    expect(within(association).getByRole("option", { name: "Unregistered Map Shape (MAP-ONLY)" })).toBeInTheDocument();
    fireEvent.change(association, { target: { value: "building-42" } });

    expect(association).toHaveValue("building-42");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it.skip("moves a point through the precision HUD with nudging, commit, and cancel", async () => {
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

  it.skip("renders direct drag feedback, snaps within 18px, and blocks an out-of-bound drop", async () => {
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

  it.skip("unpositions Outdoor Locations and cascades Route Node deletion to connected Pathways", async () => {
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
    fireEvent.click(screen.getByRole("menuitem", { name: /Deactivate Route Node/ }));

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    expect(screen.queryAllByRole("button", { name: "North Walk Pathway" })).toHaveLength(0);
  });

  it.skip("undoes and redoes Route Node deactivation with connected Pathways as one operation", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for North Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Deactivate Route Node/ }));

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

  it("reviews, cancels, and confirms Pathway closure without cascading to connected records", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-lib", name: "Library", code: "LIB", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-entrance", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: "building-lib", lat: 16.7205, lng: 121.6895, status: "Active" },
      { id: "node-junction", name: "Main Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.690, status: "Active" },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-entrance", destinationNodeId: "node-junction", distance: "120 m", time: "2 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Walk Pathway/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Walk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Pathway/ }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Library Entrance");
    expect(screen.getByRole("dialog")).toHaveTextContent("Library");
    expect(screen.getByRole("dialog")).toHaveTextContent("Will lose routability");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("complementary", { name: "Library Walk object details" })).toHaveTextContent("Two-way · Open");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");

    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Walk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Pathway/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Close Pathway" }));

    expect(screen.getByRole("complementary", { name: "Library Walk object details" })).toHaveTextContent("Two-way · Closed");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", JSON.stringify([[16.7205, 121.6895], [16.7207, 121.6897], [16.721, 121.69]]));
  });

  it("undoes and redoes a Route Node lifecycle action while preserving connected Pathways", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-entrance", destinationNodeId: "node-junction", distance: "120 m", time: "2 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-entrance", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895, status: "Active" },
      { id: "node-junction", name: "Main Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.690, status: "Active" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Deactivate Route Node/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Library Walk");
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deactivate Route Node" }));

    expect(screen.getByRole("complementary", { name: "Library Entrance object details" })).toHaveTextContent("Inactive");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("complementary", { name: "Library Entrance object details" })).toHaveTextContent("Active");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("complementary", { name: "Library Entrance object details" })).toHaveTextContent("Inactive");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "Library Walk" } });
    expect(await screen.findByRole("button", { name: /Library Walk Pathway/ })).toBeInTheDocument();
  });

  it("saves an Area polygon as the named Building shown in Preview", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    clickMap(16.720, 121.690);

    expect(screen.getByText("Points plotted: 3")).toBeInTheDocument();
  });

  it("opens Create-or-Attach when a footprint closes and preserves its geometry across tabs", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));

    expect(screen.getByRole("region", { name: "Create or attach Building" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "★ Create New Building" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-testid="move-point-marker"]').length).toBe(3);

    fireEvent.click(screen.getByRole("tab", { name: "🔗 Attach Existing Building" }));

    expect(screen.getByRole("tab", { name: "🔗 Attach Existing Building" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-testid="move-point-marker"]').length).toBe(3);
  });

  it("opens Add Building after Save shape and preserves the footprint when details are cancelled", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    expect(screen.getByRole("dialog", { name: "Add Building" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Draft Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "DRAFT-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add Building" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Add Building" })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="move-point-marker"]').length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Open Building details" }));
    expect(screen.getByLabelText("Building name")).toHaveValue("Draft Annex");
  });

  it("creates a Building through the canonical Locations service and uses the returned ID", async () => {
    const save = vi.fn(async (draft: Parameters<typeof services.locations.save>[0]) => ({
      ...draft,
      id: "42",
      name: draft.name,
      code: draft.code,
      type: "Building" as const,
      parentId: null,
      status: "Active" as const,
      lat: null,
      lng: null,
      positioned: false,
    }));
    services.locations.save = save;
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Backend Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "BACK-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ name: "Backend Hall", code: "BACK-01", type: "Building" });
    expect(save.mock.calls[0]?.[0].id).toBeUndefined();
    expect(screen.getByRole("button", { name: "＋ Add indoor location" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload building photo")).not.toBeInTheDocument();
  });

  it("keeps Building details open when the canonical create fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Location code already exists."));
    services.locations.save = save;
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Duplicate Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "DUP-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "Add Building" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Add Building" })).getByRole("alert")).toHaveTextContent("Location code already exists.");
  });

  it("exposes only eligible active Buildings without footprint in Attach Existing Building", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-open", name: "Science Hall", code: "SCI", points: [] },
      { id: "building-linked", name: "University Gym", code: "GYM", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.click(screen.getByRole("tab", { name: "🔗 Attach Existing Building" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search existing Buildings" }), { target: { value: "i" } });

    expect(screen.queryByRole("button", { name: /University Gym/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Science Hall/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    expect(screen.getByRole("dialog", { name: "Preview Map" })).toHaveTextContent("Science Annex · building");
  });

  it("launches a guided Entrance Route Node draft for the completed Building", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Science Annex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "SCI-ANN" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));
    fireEvent.click(screen.getByRole("button", { name: "🚪 Add Entrance Route Node Now" }));

    expect(screen.getByRole("button", { name: "Route Node" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Route Node type")).toHaveValue("Entrance");
    expect(screen.getByLabelText("Route Node name")).toHaveValue("Science Annex Entrance");
  });

  it("places an Entrance by map click and allows its coordinates to be edited manually", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Entrance" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "Science Annex Entrance" } });
    clickMap(16.7208, 121.6902);

    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7208,121.6902"]')).toBeTruthy();
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
    expect(screen.getByRole("region", { name: "Building summary" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Building content" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Walking access" })).toBeInTheDocument();
    expect(screen.queryByText(/Move footprint/i)).not.toBeInTheDocument();
  });

  it("browses an Active Pathway and applies its metadata from the unified card", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "active-path", name: "Active Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Active", allowedModes: ["Walking"], pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
    fireEvent.change(screen.getByPlaceholderText("Search Pathways"), { target: { value: "Active Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: /Active Walk/ }));

    expect(screen.getByRole("complementary", { name: "Active Walk object details" })).toBeInTheDocument();
    expect(screen.queryByText("Calibrate Path Points")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edit Pathway" })).not.toBeInTheDocument();
    expect(Array.from((screen.getByLabelText("Pathway type") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["Walkway", "Road"]);
    expect(screen.getByRole("checkbox", { name: "Vehicle" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Pathway name" }), { target: { value: "Renamed Active Walk" } });

    const apply = screen.getByRole("button", { name: "Apply changes" });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(screen.getByRole("complementary", { name: "Renamed Active Walk object details" })).toBeInTheDocument();
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

  it("applies Parent Pathway metadata and selected Path Point geometry as one draft", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897], [16.7208, 121.6898]] },
    ]);
    renderEditor();

    await screen.findByTestId("path-geometry");
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Walk Pathway" }));
    fireEvent.change(screen.getByLabelText("Pathway shade"), { target: { value: "Fully Shaded" } });
    fireEvent.change(screen.getByLabelText("Pathway direction"), { target: { value: "One-way" } });
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.change(screen.getByLabelText("Pathway shade"), { target: { value: "Unshaded" } });

    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Save Pathway" }));

    expect(screen.getByLabelText("Pathway shade")).toHaveValue("Unshaded");
    expect(screen.getByText("Unshaded · Walkway · One-way · Open")).toBeInTheDocument();
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6897],[16.7208,121.6898],[16.721,121.69]]");
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
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

  it("starts a new Pathway with a blank name placeholder and constrained Way type", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ New Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Map marker at 16.721,121.69" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Map marker at 16.7205,121.6895" })[1]);

    const name = screen.getByRole("textbox", { name: "Pathway name" });
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("placeholder", "e.g. Science Walk");
    expect(Array.from((screen.getByLabelText("Pathway type") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["Walkway", "Road"]);
    expect(screen.getByRole("checkbox", { name: "Vehicle" })).toBeDisabled();
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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Engineering Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "ENG-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Classrooms and Laboratories" } });
    fireEvent.change(screen.getByLabelText("Building keywords"), { target: { value: "engineering, labs" } });

    expect(screen.getAllByText(/Derived label anchor:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no copied outdoor coordinate stored on Building/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("does not report the in-progress polygon as an overlapping building", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    expect(screen.queryByText(/Advisory: Footprint overlaps with/)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    expect(screen.getByText(/Advisory: Footprint overlaps with Existing Hall/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "New Overlapping Hall" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "NOH-01" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });

    const saveBtn = screen.getByRole("button", { name: "Save Building" });
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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.click(screen.getByRole("tab", { name: /Attach Existing Building/i }));

    expect(screen.getByText("Eligible Building · ELIG-01")).toBeInTheDocument();
    expect(screen.getAllByText("Eligible").length).toBeGreaterThan(0);

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

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
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

  it("saves a created Building footprint through Admin Draft gateway and refreshes canonical Locations query", async () => {
    const mockLocationsList: Location[] = [
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    services.map.saveDraft = vi.fn(async (command: SaveDraftCommand) => {
      const flatOps = command.operations.flatMap((op: WorkingOperation) =>
        op.type === "compound_batch" && op.nestedOperations ? op.nestedOperations : [op]
      );
      const locOp = flatOps.find((op: WorkingOperation) => op.domain === "Locations" && op.type === "create_entity");
      if (locOp?.after) {
        mockLocationsList.push(locOp.after as unknown as Location);
      }
      return {
        success: true as const,
        newDraftVersion: command.baseDraftVersion + 1,
        updatedAt: new Date().toISOString(),
      };
    });
    vi.mocked(services.locations.list).mockImplementation(async () => ({
      items: mockLocationsList,
      total: mockLocationsList.length,
      page: 1,
      pageSize: 50,
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MapEditor />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Engineering Complex" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "ENG-CMP" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Engineering Labs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    // Open save review dialog and confirm save
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Save Changes" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(services.map.saveDraft).toHaveBeenCalledTimes(1);
    });

    const callArgs = vi.mocked(services.map.saveDraft!).mock.calls[0][0];
    expect(callArgs.operations).toHaveLength(1);
    expect(callArgs.operations[0].type).toBe("compound_batch");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["locations"] });

    const locationsAfterSave = await services.locations.list();
    const createdBuilding = locationsAfterSave.items.find((loc: Location) => loc.code === "ENG-CMP");
    expect(createdBuilding).toBeDefined();
    expect(createdBuilding?.name).toBe("Engineering Complex");
    expect(createdBuilding?.type).toBe("Building");
    expect(createdBuilding?.lat).toBeNull();
    expect(createdBuilding?.lng).toBeNull();
    expect(createdBuilding?.positioned).toBe(false);
  });

  it("undoes and redoes compound Create New Building operation atomically as one action", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Atomic Lab" } });
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "ATM-LAB" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Laboratory" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    // Preview should show the added building
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    let preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("Atomic Lab");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Undo: compound batch is undone as ONE step
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");

    // Building should be removed from preview
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).not.toHaveTextContent("Atomic Lab");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Redo: compound batch is reapplied as ONE step
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
    fireEvent.click(screen.getByRole("button", { name: "Preview Map" }));
    preview = screen.getByRole("dialog", { name: "Preview Map" });
    expect(preview).toHaveTextContent("Atomic Lab");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("undoes and redoes compound Attach Existing Building operation atomically as one action", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "bld-attachable", name: "Attachable Hall", code: "ATT-01", points: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.click(screen.getByRole("tab", { name: /Attach Existing Building/i }));
    fireEvent.click(screen.getByRole("button", { name: /Attachable Hall/ }));
    fireEvent.click(screen.getByRole("button", { name: "Attach Selected Building" }));

    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");

    // Undo: footprint is detached as ONE step
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("0 changes");

    // Redo: footprint is re-attached as ONE step
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("status", { name: "Working Session changes" })).toHaveTextContent("1 change");
  });

  it("sources attach candidates from unpositioned Buildings in locations query", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      {
        id: "bld-unpositioned",
        name: "Unpositioned Annex",
        code: "UNPOS-01",
        type: "Building",
        parentId: null,
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.click(screen.getByRole("tab", { name: /Attach Existing Building/i }));

    // Unpositioned Building from locations is exposed as an attach candidate
    expect(screen.getByRole("button", { name: /Unpositioned Annex/ })).toBeInTheDocument();
  });

  it("searches canonical attach candidates by Building name and code", async () => {
    vi.mocked(services.locations.list).mockResolvedValue({
      items: [{ id: "building-canonical", name: "Engineering Hall", code: "ENG-01", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    fireEvent.click(screen.getByRole("tab", { name: /Attach Existing Building/i }));

    const search = screen.getByRole("searchbox", { name: "Search existing Buildings" });
    fireEvent.change(search, { target: { value: "ENG-01" } });
    expect(screen.getByRole("button", { name: /Engineering Hall · ENG-01/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "engineering hall" } });
    expect(screen.getByRole("button", { name: /Engineering Hall · ENG-01/ })).toBeInTheDocument();
  });

  it("evaluates footprint-derived Building as routable when entrance is linked even with positioned false", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      {
        id: "bld-routable",
        name: "Routable Hall",
        code: "ROUT-01",
        points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]],
        status: "Active",
      },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      {
        id: "bld-routable",
        name: "Routable Hall",
        code: "ROUT-01",
        type: "Building",
        parentId: null,
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      {
        id: "node-entrance-1",
        name: "Main Entrance",
        nodeType: "Entrance",
        lat: 16.7205,
        lng: 121.6895,
        associatedPlaceId: "bld-routable",
        status: "Active",
      },
    ]);

    renderEditor();

    const buildingPolygon = await screen.findByRole("button", { name: "building polygon" });
    fireEvent.click(buildingPolygon);

    expect(screen.getByRole("complementary", { name: "Routable Hall object details" })).toBeInTheDocument();
    expect(screen.getByText("Linked & Routable")).toBeInTheDocument();
  });
});
