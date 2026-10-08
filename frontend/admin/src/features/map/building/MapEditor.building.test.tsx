import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import type { Location, LocationDraft } from "../../../types";
import { useMapEditorTestLifecycle, renderEditor, clickMap, confirmDeletePassword, mapFitBounds, mapFlyTo } from "../testing/mapEditorTestHarness";
import { MapEditor } from "../MapEditor";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("creates a Building without requiring a manually entered code", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));

    const generatedCode = screen.getByLabelText<HTMLInputElement>("Building code").value;
    expect(generatedCode).toMatch(/^BLDG-\d{4}$/);
    fireEvent.change(screen.getByLabelText("Building name"), { target: { value: "Auto Code Hall" } });
    fireEvent.change(screen.getByLabelText("Building function"), { target: { value: "Academic facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    expect(await screen.findByRole("complementary", { name: "Auto Code Hall object details" })).toHaveTextContent(generatedCode);
    expect(screen.getByRole("complementary", { name: "Auto Code Hall object details" })).toBeInTheDocument();
  });

  it("preserves a manually changed draft code and generates a default after discarding it", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    expect(screen.getByLabelText<HTMLInputElement>("Building code").value).toMatch(/^BLDG-\d{4}$/);
    fireEvent.change(screen.getByLabelText("Building code"), { target: { value: "CUSTOM-HALL" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add Building" })).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Building details" }));
    expect(screen.getByLabelText("Building code")).toHaveValue("CUSTOM-HALL");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add Building" })).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard Geometry" }));

    fireEvent.click(screen.getByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);
    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));
    expect(screen.getByLabelText<HTMLInputElement>("Building code").value).toMatch(/^BLDG-\d{4}$/);
  });

  it("confirms, cancels, and hard-deletes a Building with its Indoor Location warning", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    renderEditor();

    const buildingPolygon = await screen.findByRole("button", { name: "building polygon" });
    fireEvent.click(buildingPolygon);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering Hall" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Delete Building" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("associated Indoor Locations");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(services.map.removeBuilding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering Hall" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Delete Building" }));
    confirmDeletePassword();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Building" }));
    await waitFor(() => expect(services.map.removeBuilding).toHaveBeenCalledWith("building-eng"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(buildingPolygon).toBeInTheDocument();
  });

  it("changes a selected footprint-backed Building into a Facility", async () => {
    const saveLocation = vi.fn(async (draft: LocationDraft): Promise<Location> => ({
      ...draft,
      id: draft.id ?? "building-eng",
    } as Location));
    services.locations.save = saveLocation;
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", type: "Building", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", type: "Building", parentId: null, function: "Academic building", status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Engineering Hall" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Facility" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Location" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    await waitFor(() => expect(saveLocation).toHaveBeenCalledWith(expect.objectContaining({
      id: "building-eng",
      type: "Facility",
    }), []));
    expect(await screen.findByRole("complementary", { name: "Engineering Hall object details" })).toHaveTextContent("ENG");
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
    expect(screen.queryByLabelText("Building name")).not.toBeInTheDocument();
  });

  it("saves an existing footprint change without changing the Building Campus Location", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-eng", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    services.map.save = vi.fn(async () => undefined);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "▱ Reshape Footprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Update Building Footprint" }));

    await waitFor(() => expect(services.map.save).toHaveBeenCalledWith(expect.objectContaining({
      buildings: [expect.objectContaining({ id: "building-eng" })],
    })));
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

  it("does not render an ordinary marker for a positioned Building with a footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      {
        id: "building-admin",
        name: "Administration Building",
        code: "ADMIN",
        points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]],
      },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      {
        id: "building-admin",
        name: "Administration Building",
        code: "ADMIN",
        type: "Building",
        parentId: null,
        status: "Active",
        lat: 16.7205,
        lng: 121.6895,
        positioned: true,
      },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([]);

    renderEditor();

    await screen.findByRole("button", { name: "building polygon" });

    expect(document.querySelectorAll('[data-testid="saved-map-marker"][data-icon-class^="location-marker-icon"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7205,121.6895"]')).not.toBeInTheDocument();
  });

  it("does not render an ordinary marker for a positioned Facility with a footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      {
        id: "facility-admin",
        name: "Campus Gym",
        code: "GYM",
        type: "Facility",
        points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]],
      },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      {
        id: "facility-admin",
        name: "Campus Gym",
        code: "GYM",
        type: "Facility",
        parentId: null,
        status: "Active",
        lat: 16.7205,
        lng: 121.6895,
        positioned: true,
      },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([]);

    renderEditor();

    await screen.findByRole("button", { name: "building polygon" });

    expect(document.querySelectorAll('[data-testid="saved-map-marker"][data-icon-class^="location-marker-icon"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7205,121.6895"]')).not.toBeInTheDocument();
  });

  it("frames and selects a polygon Building queried from a parent-location handoff", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "building-1", name: "Stale Building Point", code: "ENG", type: "Building", parentId: null, status: "Active", lat: 16.71, lng: 121.68, positioned: true },
      { id: "room-1", name: "Room 101", code: "101", type: "Room", parentId: "building-1", status: "Active", lat: null, lng: null, positioned: false },
    ]);
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Engineering Hall", code: "ENG", points: [[16.72, 121.689], [16.722, 121.689], [16.722, 121.691]] },
    ]);
    renderEditor(["/map-editor?location=building-1"]);

    expect(await screen.findByRole("complementary", { name: "Engineering Hall object details" })).toHaveTextContent("Building content");
    await waitFor(() => expect(mapFitBounds).toHaveBeenCalledWith(
      [[16.72, 121.689], [16.722, 121.691]],
      expect.objectContaining({ maxZoom: 19 }),
    ));
    expect(mapFlyTo).not.toHaveBeenCalled();
  });

  it("keeps a persisted Building feature anchor after the Map Editor remounts", async () => {
    const concaveFootprint: [number, number][] = [
      [0, 0], [0, 4], [4, 4], [4, 3], [1, 3],
      [1, 1], [4, 1], [4, 0], [0, 0],
    ];
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-1", name: "Engineering Hall", code: "ENG", points: concaveFootprint },
    ]);
    const firstRender = renderEditor();

    expect(await screen.findByRole("button", { name: "Map marker at 0.625,0.625" })).toBeInTheDocument();

    firstRender.unmount();
    renderEditor();

    expect(await screen.findByRole("button", { name: "Map marker at 0.625,0.625" })).toBeInTheDocument();
  });

  it("saves an Area polygon as the named Building", async () => {
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

    expect(await screen.findByRole("complementary", { name: "Science Annex object details" })).toBeInTheDocument();

    expect(Array.from(document.querySelectorAll('[data-testid="saved-map-marker"]')).some((marker) =>
      marker.getAttribute("data-position")?.startsWith("16.720666"),
    )).toBe(true);
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

  it("opens Create Building when a footprint closes and preserves its geometry", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.720, 121.689);
    clickMap(16.721, 121.689);
    clickMap(16.721, 121.690);

    fireEvent.click(screen.getByRole("button", { name: "Save shape" }));

    expect(screen.getByRole("region", { name: "Create Building" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
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

  it("creates an Inactive Building through the canonical Locations service and uses the returned ID", async () => {
    const save = vi.fn(async (draft: Parameters<typeof services.locations.save>[0]) => ({
      ...draft,
      id: "42",
      name: draft.name,
      code: draft.code,
      type: "Building" as const,
      parentId: null,
      status: draft.status,
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
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: "Inactive" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Building" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ name: "Backend Hall", code: "BACK-01", type: "Building", status: "Inactive" });
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

  it("creates the feature, Building, and link together", async () => {
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

    expect(await screen.findByRole("complementary", { name: "Science Annex object details" })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /Show map issues/ }));
    fireEvent.click(await screen.findByRole("button", { name: "🚪 Add Entrance Route Node Now" }));

    expect(screen.getByRole("button", { name: "Route Node" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Route Node type")).toHaveValue("Entrance");
    expect(screen.getByLabelText("Route Node name")).toHaveValue("Science Annex Entrance");
  });

  it("shows a building room directory and associated entrances in the inspector", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-room-test", name: "Engineering Hall", code: "ENG-HALL", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.locations.list).mockResolvedValue({
      items: [{ id: "room-204", name: "Room 204", code: "204", type: "Room", parentId: "building-room-test", building: "Engineering Hall", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "entrance-eng", name: "Main Entrance", nodeType: "Entrance", associatedPlaceId: "building-room-test", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));

    expect(screen.getByRole("region", { name: "Building room directory" })).toHaveTextContent("2nd Floor");
    expect(screen.getByRole("region", { name: "Building room directory" })).toHaveTextContent("Room 204");
    expect(screen.getByRole("region", { name: "2nd Floor indoor locations" })).toHaveTextContent("Room · 204");
    expect(screen.getByRole("region", { name: "2nd Floor indoor locations" })).toHaveClass("inspector-floor-group");
    expect(screen.getByRole("region", { name: "Building entrances" })).toHaveTextContent("Main Entrance");
    expect(screen.getByRole("region", { name: "Building entrances" })).toHaveTextContent("16.72050, 121.68950");
    const buildingContent = screen.getByRole("region", { name: "Building content" });
    expect(within(buildingContent).getByRole("button", { name: "＋ Add indoor location" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Floor Level for new Indoor Location")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Building content" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Walking access" })).toBeInTheDocument();
    expect(screen.queryByText(/Move footprint/i)).not.toBeInTheDocument();
  });

  it("locates a Building when its database ID collides with an Indoor Location ID", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "6", name: "Centrum Laboratory Building", code: "CLB", points: [[16.718, 121.688], [16.719, 121.688], [16.719, 121.689]] },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "6", name: "Room 1", code: "LOC-4401", type: "Room", parentId: "1", building: "CCSICT", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false },
    ]);
    vi.mocked(services.locations.list).mockResolvedValue({
      items: [{ id: "6", name: "Room 1", code: "LOC-4401", type: "Room", parentId: "1", building: "CCSICT", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false }],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    renderEditor(["/map-editor?location=6"]);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Centrum Laboratory Building" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Room 1" })).not.toBeInTheDocument();
  });

  it("shows a center marker while drawing a building polygon", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    clickMap(16.7202, 121.6892);
    clickMap(16.7203, 121.6893);

    const marker = Array.from(document.querySelectorAll('[data-testid="saved-map-marker"]')).find((item) =>
      item.getAttribute("data-icon-class")?.startsWith("location-marker-icon"),
    );
    expect(marker).toBeDefined();
    const [latitude, longitude] = marker!.getAttribute("data-position")!.split(",").map(Number);
    expect(latitude).toBeCloseTo(16.7202, 10);
    expect(longitude).toBeCloseTo(121.6892, 10);
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
    expect(screen.getByText("Create Building")).toBeInTheDocument();

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
    expect(await screen.findByRole("complementary", { name: "Engineering Hall object details" })).toBeInTheDocument();
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

    expect(await screen.findByRole("complementary", { name: "New Overlapping Hall object details" })).toBeInTheDocument();
  });

  it("saves a created Building footprint through the canonical Locations service and refreshes the map", async () => {
    const mockLocationsList: Location[] = [
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const saveLocation = vi.fn(async (draft: LocationDraft): Promise<Location> => {
      const saved: Location = {
        ...draft,
        id: "building-created",
        type: "Building",
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      };
      mockLocationsList.push(saved);
      return saved;
    });
    services.locations.save = saveLocation;
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

    await waitFor(() => expect(saveLocation).toHaveBeenCalledWith(expect.objectContaining({
      name: "Engineering Complex",
      code: "ENG-CMP",
      type: "Building",
      function: "Engineering Labs",
      lat: null,
      lng: null,
      positioned: false,
      polygonCoordinates: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]],
    })));

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
    expect(screen.getByText("Routable", { selector: ".inspector-card-header p" })).toBeInTheDocument();
  });
});
