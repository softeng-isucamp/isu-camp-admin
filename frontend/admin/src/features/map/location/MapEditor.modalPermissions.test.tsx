import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { viewOnlyPermissions } from "../../../lib/permissions";
import type { Location } from "../../../types";
import { mapTestSession, renderEditor, useMapEditorTestLifecycle } from "../testing/mapEditorTestHarness";
import { useMapOverlay } from "../session/useMapOverlay";
import { WorkingSessionManager } from "../WorkingSessionManager";
import { useLocationDetailsSave } from "./useLocationDetailsSave";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

const room: Location = { id: "room", name: "Room 204", code: "R204", type: "Room", parentId: "hall", building: "Hall", status: "Active", floor: "2nd Floor", function: "Classroom", lat: null, lng: null, positioned: false };
const openRoomDetails = async () => {
  fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: room.name } });
  fireEvent.click(await screen.findByRole("button", { name: "Room 204 Location" }));
  fireEvent.click(screen.getByRole("button", { name: "More actions for Room 204" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
  return screen.findByRole("dialog", { name: "Edit Location" });
};
const seedRoom = (positioned = false) => {
  mapTestSession.role = "admin";
  mapTestSession.permissions = { ...viewOnlyPermissions(), edit: true };
  const record = positioned ? { ...room, lat: 16.7205, lng: 121.6895, positioned: true } : room;
  vi.mocked(services.map.locations).mockResolvedValue([record]);
  vi.mocked(services.locations.list).mockResolvedValue({ items: [record], total: 1, page: 1, pageSize: 100 });
};

describe("Map owner modal permissions", () => {
  useMapEditorTestLifecycle();

  it("closes Edit Details when Edit is revoked", async () => {
    seedRoom(true);
    renderEditor();
    await openRoomDetails();
    mapTestSession.permissions = viewOnlyPermissions();
    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "Room" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Location" })).not.toBeInTheDocument());
  });

  it("blocks a direct Location details save without Edit", async () => {
    mapTestSession.role = "admin";
    mapTestSession.permissions = { ...viewOnlyPermissions(), add: true };
    const save = vi.fn(async (location) => location);
    services.locations.save = save;
    const manager = new WorkingSessionManager();
    const { result } = renderHook(() => useLocationDetailsSave({ workingSession: manager, overlay: useMapOverlay([]), refreshMapData: async () => {} }));
    await act(async () => { await result.current.save({ building: undefined, buildingLocation: undefined, location: room }, { ...room, name: "Unauthorized" }, undefined); });
    expect(save).not.toHaveBeenCalled();
    expect(services.locations.saveIndoorPosition).not.toHaveBeenCalled();
    expect(manager.getPastOperations()).toHaveLength(0);
  });

  it("hides Pick on map from Edit-only details for an unpositioned indoor location", async () => {
    seedRoom();
    renderEditor();
    await openRoomDetails();
    expect(screen.queryByRole("button", { name: "Pick on map" })).not.toBeInTheDocument();
  });

  it("keeps Pick on map for Edit-only details of a positioned indoor location", async () => {
    seedRoom(true);
    renderEditor();
    await openRoomDetails();
    expect(screen.getByRole("button", { name: "Pick on map" })).toBeInTheDocument();
  });
});
