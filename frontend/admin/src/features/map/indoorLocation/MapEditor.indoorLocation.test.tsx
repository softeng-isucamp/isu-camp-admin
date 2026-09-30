import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, clickMap, mapTestState } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("omits parent building and spatial source from indoor location cards", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "room-113", name: "Room 113", code: "ADM-113", type: "Room", parentId: "admin-building", building: "Administration Building", floor: "1st Floor", status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Classroom" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Room 113" } });
    fireEvent.click(await screen.findByRole("button", { name: /Room 113 Location/ }));

    const locationCard = screen.getByRole("complementary", { name: "Room 113 object details" });
    expect(locationCard).toHaveTextContent("1st Floor");
    expect(locationCard).toHaveTextContent("Classroom");
    expect(locationCard).not.toHaveTextContent("Parent building");
    expect(locationCard).not.toHaveTextContent("Spatial source");
  });

  it("previews an indoor location point and saves coordinates only from the position sidecard", async () => {
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
