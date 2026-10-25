import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { allPermissions, viewOnlyPermissions } from "../../../lib/permissions";
import { mapTestSession, useMapEditorTestLifecycle } from "../testing/mapEditorTestHarness";
import { useMapOverlay } from "./useMapOverlay";
import { useDeleteConfirmation } from "./useDeleteConfirmation";
import type { DeleteConfirmation } from "../DeleteConfirmationModal";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

const renderDeletion = () => {
  mapTestSession.role = "admin";
  mapTestSession.permissions = allPermissions();
  vi.mocked(services.auth.confirmPassword).mockResolvedValue(undefined);
  return renderHook(() => useDeleteConfirmation({ overlay: useMapOverlay([]), refreshMapData: async () => {}, onError: vi.fn(), onDeleted: vi.fn() }));
};
const expectNoDeletion = () => {
  expect(services.map.removeBuilding).not.toHaveBeenCalled();
  expect(services.map.deleteRouteNode).not.toHaveBeenCalled();
  expect(services.map.deletePathway).not.toHaveBeenCalled();
};

describe("Map delete dialog permissions", () => {
  useMapEditorTestLifecycle();

  it.each(["building", "route_node", "pathway"] as const)("closes an open %s deletion and forgets its password when Delete is revoked", async (kind) => {
    const { result, rerender } = renderDeletion();
    act(() => {
      result.current.setDeleteConfirmation({ kind, id: "object-1", name: "Object" });
      result.current.passwordConfirmation.setPassword("password123");
    });
    mapTestSession.permissions = viewOnlyPermissions();
    rerender();
    expect(result.current.deleteConfirmation).toBeNull();
    expect(result.current.passwordConfirmation.password).toBe("");
    await act(async () => { await result.current.confirmDelete(); });
    expectNoDeletion();
  });

  it("does not delete after permission is revoked during password confirmation", async () => {
    const { result, rerender } = renderDeletion();
    let acceptPassword!: () => void;
    vi.mocked(services.auth.confirmPassword).mockImplementation(() => new Promise<void>((resolve) => { acceptPassword = resolve; }));
    act(() => {
      result.current.setDeleteConfirmation({ kind: "route_node", id: "object-1", name: "Object" });
      result.current.passwordConfirmation.setPassword("password123");
    });
    let pending!: Promise<void>;
    act(() => { pending = result.current.confirmDelete(); });
    mapTestSession.permissions = viewOnlyPermissions();
    rerender();
    await act(async () => { acceptPassword(); await pending; });
    expectNoDeletion();
  });

  it("does not act on an obsolete dialog after it is closed and replaced during password confirmation", async () => {
    const { result } = renderDeletion();
    let acceptPassword!: () => void;
    vi.mocked(services.auth.confirmPassword).mockImplementation(() => new Promise<void>((resolve) => { acceptPassword = resolve; }));
    const first: DeleteConfirmation = { kind: "pathway", id: "first", name: "First" };
    act(() => {
      result.current.setDeleteConfirmation(first);
      result.current.passwordConfirmation.setPassword("password123");
    });
    let pending!: Promise<void>;
    act(() => { pending = result.current.confirmDelete(); });
    act(() => result.current.closeConfirmation());
    act(() => result.current.setDeleteConfirmation({ kind: "pathway", id: "second", name: "Second" }));
    await act(async () => { acceptPassword(); await pending; });
    expectNoDeletion();
    expect(result.current.deleteConfirmation?.id).toBe("second");
  });
});
