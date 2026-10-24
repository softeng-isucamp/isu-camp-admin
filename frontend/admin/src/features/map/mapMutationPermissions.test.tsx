import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { allPermissions, viewOnlyPermissions } from "../../lib/permissions";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { mapTestSession, useMapEditorTestLifecycle } from "./testing/mapEditorTestHarness";
import { useMapOverlay } from "./session/useMapOverlay";
import { useSavingAction } from "./session/useSavingAction";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { usePathwayEditing } from "./pathway/usePathwayEditing";
import { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import { createRouteNodeWorkflow } from "./routeNode/RouteNodeWorkflow";
import { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";

vi.mock("leaflet", async () => (await import("./testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("./testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../services/api", async () => (await import("./testing/mapEditorMocks")).apiMock());
vi.mock("../auth/AuthContext", async () => (await import("./testing/mapEditorMocks")).authContextMock());

const nodes: RouteNode[] = [
  { id: "a", name: "North", nodeType: "Junction", lat: 16.7205, lng: 121.6895 },
  { id: "b", name: "South", nodeType: "Junction", lat: 16.721, lng: 121.69 },
  { id: "c", name: "West", nodeType: "Junction", lat: 16.7205, lng: 121.69 },
  { id: "d", name: "East", nodeType: "Junction", lat: 16.721, lng: 121.6895 },
];
const path: Pathway = { id: "saved", name: "North Walk", sourceNodeId: "a", destinationNodeId: "b", type: "Walkway", shade: "Unknown", direction: "Two-way", status: "Active", allowedModes: ["Walking"], pathPoints: [[16.7207, 121.6897]] };
const building: Building = { id: "hall", name: "Hall", code: "H", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690], [16.720, 121.690]] };
const room: Location = { id: "room", name: "Room", code: "R", type: "Room", parentId: "hall", status: "Active", lat: 16.7205, lng: 121.6895, positioned: true };
const setPermissions = (permissions = allPermissions()) => {
  mapTestSession.role = "admin";
  mapTestSession.permissions = permissions;
};

const renderTools = () => {
  const workingSession = new WorkingSessionManager();
  return renderHook(() => {
    const overlay = useMapOverlay([]);
    const saving = useSavingAction();
    return {
      pathway: usePathwayEditing({ workingSession, overlay, saving, network: { nodes, directoryNodes: nodes, directoryPathways: [path, { ...path, id: "crossing", name: "Cross Walk", sourceNodeId: "c", destinationNodeId: "d", pathPoints: [] }], campusBoundary: [] }, selectedPathId: null, refreshMapData: async () => {}, onError: vi.fn() }),
      point: useRouteNodePointTool({ workflow: createRouteNodeWorkflow({ adapter: services.map, workingSession }), overlay, saving, context: { buildings: [], locations: [], nodes, campusBoundary: [] }, refreshMapData: async () => {}, onError: vi.fn(), editorContext: { mode: "move", selected: null } }),
      indoor: useIndoorLocationPlacement(overlay, { buildings: [building], locations: [room], zoom: 20 }, vi.fn()),
    };
  });
};

describe("Map mutation permission guards", () => {
  useMapEditorTestLifecycle();

  it("rejects standalone pathway mutations after Edit is removed", async () => {
    setPermissions();
    const { result, rerender } = renderTools();
    act(() => result.current.pathway.loadForEditing(path));
    setPermissions({ ...viewOnlyPermissions(), add: true });
    rerender();
    act(() => {
      result.current.pathway.setPathPoints([[16.7208, 121.6898]]);
      result.current.pathway.insertPathPoint(0);
      result.current.pathway.setPathwayDraft({ ...path, name: "Unauthorized" });
    });
    expect(result.current.pathway.pathPoints).toEqual(path.pathPoints);
    expect(result.current.pathway.pathwayDraft?.name).toBe(path.name);
    await act(async () => { expect(await result.current.pathway.saveShape()).toBe(false); });
    expect(services.map.updatePathway).not.toHaveBeenCalled();
  });

  it("rejects direct move and save handlers without Edit", async () => {
    setPermissions();
    const { result, rerender } = renderTools();
    act(() => result.current.point.startMove(nodes[0]));
    setPermissions({ ...viewOnlyPermissions(), add: true });
    rerender();
    act(() => result.current.point.updateMovePosition([16.7208, 121.6898]));
    expect(result.current.point.position).toEqual([nodes[0].lat, nodes[0].lng]);
    await act(async () => { expect(await result.current.point.savePosition()).toBeNull(); });
    expect(services.map.updateRouteNode).not.toHaveBeenCalled();
  });

  it("rejects direct reposition, clear and save of an existing indoor marker for Add-only", async () => {
    setPermissions({ ...viewOnlyPermissions(), add: true });
    const { result } = renderTools();
    act(() => { expect(result.current.indoor.begin(building, room)).toBe(false); });
    expect(result.current.indoor.placement).toBeNull();
    // Even a caller supplying a stale placement must pass the save-time check.
    act(() => result.current.indoor.setPlacement({ buildingId: building.id, locationId: room.id, position: [16.7206, 121.6896] }));
    await act(async () => {
      await result.current.indoor.clear(building, room);
      expect(await result.current.indoor.save()).toBeNull();
    });
    expect(services.locations.saveIndoorPosition).not.toHaveBeenCalled();
  });

  it("keeps Edit-only repositioning and clearing available", async () => {
    setPermissions({ ...viewOnlyPermissions(), edit: true });
    vi.mocked(services.locations.saveIndoorPosition).mockResolvedValue(room);
    const { result } = renderTools();
    act(() => { expect(result.current.indoor.begin(building, room)).toBe(true); });
    act(() => result.current.indoor.handleMapClick([16.7206, 121.6896]));
    await act(async () => { await result.current.indoor.save(); });
    expect(services.locations.saveIndoorPosition).toHaveBeenCalledWith({ id: room.id, buildingId: building.id, lat: 16.7206, lng: 121.6896 });
    await act(async () => { await result.current.indoor.clear(building, room); });
    expect(services.locations.saveIndoorPosition).toHaveBeenLastCalledWith({ id: room.id, buildingId: building.id, lat: null, lng: null });
  });

  it("closes conversion and blocks its save when Add is revoked", async () => {
    setPermissions();
    const { result, rerender } = renderTools();
    act(() => result.current.pathway.loadForEditing(path));
    act(() => result.current.pathway.setSelectedPathPointIndex(0));
    act(() => result.current.pathway.startConversion([]));
    expect(result.current.pathway.conversionDraft).not.toBeNull();
    setPermissions({ ...viewOnlyPermissions(), edit: true });
    rerender();
    expect(result.current.pathway.conversionDraft).toBeNull();
    await act(async () => { await result.current.pathway.saveConversion(vi.fn()); });
    expect(services.map.convertPathPoint).not.toHaveBeenCalled();
  });

  it("allows Add-only Create Junction with the associated pathway split", async () => {
    setPermissions({ ...viewOnlyPermissions(), add: true });
    const { result } = renderTools();
    const onCreated = vi.fn();
    await act(async () => {
      await result.current.pathway.createJunctionAtCrossing(onCreated, { pathwayAId: path.id, pathwayBId: "crossing", point: { latitude: 16.72075, longitude: 121.68975 } });
    });
    expect(services.map.createRouteNode).toHaveBeenCalledWith(expect.objectContaining({ lat: 16.72075, lng: 121.68975 }));
    expect(onCreated).toHaveBeenCalled();
  });
});
