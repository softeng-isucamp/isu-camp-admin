import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, clickMap, mapTestState, mapZoomEndHandler } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("offers a choice when a clicked Pathway overlaps other map objects", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Active", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByTestId("path-geometry"));

    expect(screen.getByRole("dialog", { name: "Choose overlapping object" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Select Library Walk Pathway" }));
    expect(screen.getByRole("complementary", { name: "Library Walk object details" })).toBeVisible();
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

    const popover = screen.getByRole("dialog", { name: "Choose overlapping object" });
    expect(popover).toHaveTextContent("Library");
    expect(popover).toHaveTextContent("Library Entrance");
    expect(popover).toHaveAttribute("data-anchor", "16.7205,121.6895");
    expect(popover).toHaveStyle({ maxHeight: "min(50vh, 420px)", overflowY: "auto" });

    fireEvent.click(screen.getByRole("button", { name: "Select Library Entrance Route Node" }));
    expect(screen.getByRole("complementary", { name: "Library Entrance object details" })).toBeInTheDocument();
  });

  it("clears overview zoom of pins while preserving footprints and pathways", async () => {
    mapTestState.visibleBounds = {
      getSouth: () => 16.7,
      getNorth: () => 16.8,
      getWest: () => 121.6,
      getEast: () => 121.8,
    };
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-admin", name: "Administration Building", code: "ADMIN", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "Campus Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", pathPoints: [], shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Active", allowedModes: ["Walking"] },
    ]);
    renderEditor();

    await screen.findByRole("button", { name: "building polygon" });
    expect(screen.getByTestId("path-geometry")).toBeInTheDocument();
    expect(screen.getAllByTestId("saved-map-marker").length).toBeGreaterThan(0);

    act(() => { mapTestState.zoom = 17; mapZoomEndHandler?.(); });
    expect(screen.getByRole("button", { name: "building polygon" })).toBeInTheDocument();
    expect(screen.getByTestId("path-geometry")).toBeInTheDocument();
    expect(screen.queryAllByTestId("saved-map-marker")).toHaveLength(0);

    act(() => { mapTestState.zoom = 18; mapZoomEndHandler?.(); });
    expect(screen.getAllByTestId("saved-map-marker").length).toBeGreaterThan(0);
  });

  it("keeps a selected Location findable in overview zoom", async () => {
    mapTestState.visibleBounds = {
      getSouth: () => 16.7,
      getNorth: () => 16.8,
      getWest: () => 121.6,
      getEast: () => 121.8,
    };
    renderEditor();
    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    await screen.findByRole("button", { name: /Library Location/ });

    act(() => { mapTestState.zoom = 17; mapZoomEndHandler?.(); });
    expect(screen.queryAllByTestId("saved-map-marker")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Library Location/ }));
    const selectedMarkers = screen.getAllByTestId("saved-map-marker");
    expect(selectedMarkers).toHaveLength(1);
    expect(selectedMarkers[0]).toHaveAttribute("data-icon-class", "location-marker-icon selected");
  });

  it("deselects the inspected feature when the administrator clicks empty canvas", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    expect(screen.getByRole("complementary", { name: "Library object details" })).toBeInTheDocument();

    clickMap(16.7208, 121.6902);

    expect(screen.queryByRole("complementary", { name: "Library object details" })).not.toBeInTheDocument();
  });

  it("does not highlight a colliding Pathway when a Route Node is selected", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "42", name: "Collision Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.69 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "42", name: "Collision Pathway", sourceNodeId: "42", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Active", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Collision Junction" } });
    fireEvent.click(await screen.findByRole("button", { name: "Collision Junction Route Node" }));

    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-color", "#005931");
  });

  it("recomputes viewport culling when selection changes type but keeps the same ID", async () => {
    mapTestState.visibleBounds = {
      getSouth: () => 0,
      getNorth: () => 1,
      getWest: () => 0,
      getEast: () => 1,
    };
    vi.mocked(services.map.locations).mockResolvedValue([]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "42", name: "Collision Junction", nodeType: "Junction", associatedPlaceId: null, lat: 10, lng: 10 },
      { id: "node-b", name: "Remote Junction", nodeType: "Junction", associatedPlaceId: null, lat: 11, lng: 11 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "42", name: "Collision Pathway", sourceNodeId: "42", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Active", pathPoints: [] },
    ]);
    renderEditor();

    const search = await screen.findByPlaceholderText("Search campus places...");
    fireEvent.change(search, { target: { value: "Collision Pathway" } });
    fireEvent.click(await screen.findByRole("button", { name: "Collision Pathway Pathway" }));
    expect(screen.queryByRole("button", { name: "Map marker at 10,10" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Collision Junction" } });
    fireEvent.click(await screen.findByRole("button", { name: "Collision Junction Route Node" }));
    expect(await screen.findByRole("button", { name: "Map marker at 10,10" })).toBeInTheDocument();
  });

  it("keeps a colliding Indoor Location from replacing the selected Pathway inspector", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "42", name: "Collision Room", code: "42", type: "Room", parentId: "building-1", status: "Active", lat: null, lng: null, positioned: false },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "42", name: "Collision Pathway", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Active", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Collision Pathway" } });
    fireEvent.click(await screen.findByRole("button", { name: "Collision Pathway Pathway" }));

    expect(await screen.findByRole("complementary", { name: "Collision Pathway object details" })).toHaveTextContent("[Walking Network]");
    expect(screen.queryByRole("complementary", { name: "Collision Room object details" })).not.toBeInTheDocument();
  });
});
