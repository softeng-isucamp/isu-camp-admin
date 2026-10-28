import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { viewOnlyPermissions } from "../../../lib/permissions";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, clickMap, mapFitBounds, mapFlyTo, mapTestSession, mapTestState } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("omits parent building and spatial source from indoor location cards", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "room-113", name: "Room 113", code: "ADM-113", type: "Room", parentId: "admin-building", building: "Administration Building", floor: "Ground Floor", status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Classroom" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Room 113" } });
    fireEvent.click(await screen.findByRole("button", { name: /Room 113 Location/ }));

    const locationCard = screen.getByRole("complementary", { name: "Room 113 object details" });
    expect(locationCard).toHaveTextContent("Ground Floor");
    expect(locationCard).toHaveTextContent("Classroom");
    expect(locationCard).not.toHaveTextContent("Parent building");
    expect(locationCard).not.toHaveTextContent("Spatial source");
  });

  it("previews an indoor location point and saves coordinates only from the position sidecard", async () => {
    mapTestSession.role = "admin";
    mapTestSession.permissions = { ...viewOnlyPermissions(), add: true };
    const building = { id: "placement-building", name: "Placement Hall", code: "PH", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690], [16.720, 121.690]] as [number, number][] };
    const room = { id: "placement-room", name: "Room 204", code: "204", type: "Room" as const, parentId: building.id, building: building.name, floor: "2nd Floor", function: "Classroom", status: "Active" as const, lat: null, lng: null, positioned: false };
    mapTestState.zoom = 20;
    mapTestState.visibleBounds = { getSouth: () => 16.719, getNorth: () => 16.722, getWest: () => 121.688, getEast: () => 121.691 };
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([room]);
    vi.mocked(services.locations.list).mockResolvedValue({ items: [room], total: 1, page: 1, pageSize: 100 });
    vi.mocked(services.locations.saveIndoorPosition).mockImplementation(async (request) => ({
      ...room,
      parentId: request.buildingId,
      lat: request.lat,
      lng: request.lng,
      positioned: request.lat !== null && request.lng !== null,
    }));
    renderEditor(["/map-editor?indoorLocation=placement-room&place=1"]);

    const sidecard = await screen.findByRole("complementary", { name: "Indoor location position editor" });
    expect(sidecard).toHaveTextContent("Room 204");
    expect(sidecard).toHaveTextContent("Click inside the building footprint");
    expect(screen.getByRole("button", { name: "Save Position" })).toBeDisabled();
    expect(services.locations.saveIndoorPosition).not.toHaveBeenCalled();

    clickMap(16.7205, 121.6895);
    await waitFor(() => expect(sidecard).toHaveTextContent("16.720500"));
    expect(services.locations.saveIndoorPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    await waitFor(() => expect(services.locations.saveIndoorPosition).toHaveBeenCalledWith({
      id: room.id,
      buildingId: building.id,
      lat: 16.7205,
      lng: 121.6895,
    }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Indoor location position editor" })).not.toBeInTheDocument());
  });
});

describe("Indoor marker permissions", () => {
  useMapEditorTestLifecycle();
  const building = { id: "placement-building", name: "Placement Hall", code: "PH", classification: "College" as const, points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690], [16.720, 121.690]] as [number, number][] };
  const room = { id: "placement-room", name: "Room 204", code: "204", type: "Room" as const, parentId: building.id, building: building.name, status: "Active" as const, lat: 16.7205, lng: 121.6895, positioned: true };
  const setup = () => {
    mapTestSession.role = "admin";
    mapTestSession.permissions = { ...viewOnlyPermissions(), add: true };
    mapTestState.zoom = 20;
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([room]);
    vi.mocked(services.locations.list).mockResolvedValue({ items: [room], total: 1, page: 1, pageSize: 100 });
  };

  it("hides Reposition and Clear for an Add-only administrator", async () => {
    setup();
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));
    if (screen.queryByRole("button", { name: "Select Placement Hall Building" })) fireEvent.click(screen.getByRole("button", { name: "Select Placement Hall Building" }));
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Placement Hall" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Mark indoor location/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mark indoor location" });
    expect(within(dialog).getByText("Room 204")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reposition" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("rejects Add-only handoffs into repositioning a saved marker", async () => {
    setup();
    renderEditor(["/map-editor?indoorLocation=placement-room&place=1"]);
    await screen.findByPlaceholderText("Search campus places...");
    await waitFor(() => expect(mapFlyTo).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Save Position" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Indoor location position editor" })).not.toBeInTheDocument();
    expect(services.locations.saveIndoorPosition).not.toHaveBeenCalled();
  });
});

describe("Searching for a Location without a marker", () => {
  useMapEditorTestLifecycle();
  const building = { id: "search-building", name: "Engineering Hall", code: "ENG", classification: "College" as const, points: [[16.720, 121.689], [16.722, 121.689], [16.722, 121.691]] as [number, number][] };
  const room = { id: "search-room", name: "Room 204", code: "204", type: "Room" as const, parentId: building.id, building: building.name, status: "Active" as const, lat: null, lng: null, positioned: false };
  const searchFor = async (name: string) => {
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: name } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${name} Location`) }));
  };

  it("frames the parent Building while keeping the searched Location selected", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([room]);
    renderEditor();

    await searchFor("Room 204");

    expect(screen.getByRole("complementary", { name: "Room 204 object details" })).toBeInTheDocument();
    await waitFor(() => expect(mapFitBounds).toHaveBeenCalledWith(
      [[16.72, 121.689], [16.722, 121.691]],
      expect.objectContaining({ maxZoom: 19 }),
    ));
    expect(mapFlyTo).not.toHaveBeenCalled();
    expect(await screen.findByText("Room 204 has no map marker yet. Showing its building, Engineering Hall.", { exact: false })).toBeInTheDocument();
  });

  it("finds the parent Building by name when the Location has no parent ID", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([{ ...room, parentId: null }]);
    renderEditor();

    await searchFor("Room 204");

    await waitFor(() => expect(mapFitBounds).toHaveBeenCalled());
    expect(await screen.findByText("Showing its building, Engineering Hall.", { exact: false })).toBeInTheDocument();
  });

  it("stays put and says so when the parent Building has no footprint", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([{ ...building, points: [[16.72, 121.689]] as [number, number][] }]);
    vi.mocked(services.map.locations).mockResolvedValue([room]);
    renderEditor();

    await searchFor("Room 204");

    expect(screen.getByRole("complementary", { name: "Room 204 object details" })).toBeInTheDocument();
    expect(await screen.findByText("Room 204 has no map marker and no mapped building.", { exact: false })).toBeInTheDocument();
    expect(mapFitBounds).not.toHaveBeenCalled();
    expect(mapFlyTo).not.toHaveBeenCalled();
  });

  it("stays put and says so when the Location has no parent Building", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([{ ...room, parentId: null, building: undefined }]);
    renderEditor();

    await searchFor("Room 204");

    expect(await screen.findByText("Room 204 has no map marker and no mapped building.", { exact: false })).toBeInTheDocument();
    expect(mapFitBounds).not.toHaveBeenCalled();
    expect(mapFlyTo).not.toHaveBeenCalled();
  });

  it("still flies to a positioned Location's marker", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([building]);
    vi.mocked(services.map.locations).mockResolvedValue([{ ...room, lat: 16.721, lng: 121.69, positioned: true }]);
    renderEditor();

    await searchFor("Room 204");

    await waitFor(() => expect(mapFlyTo).toHaveBeenCalledWith([16.721, 121.69], 19, expect.anything()));
    expect(mapFitBounds).not.toHaveBeenCalled();
    expect(screen.queryByText(/no map marker/)).not.toBeInTheDocument();
  });
});
