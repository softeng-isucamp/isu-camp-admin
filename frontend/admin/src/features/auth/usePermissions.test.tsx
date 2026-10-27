import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as AuthContext from "./AuthContext";
import { usePermissions } from "./usePermissions";
import type { Session } from "../../types";

const signedInAs = (session: Session | null) =>
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    session, login: vi.fn(), logout: vi.fn(), loading: false, updateSession: vi.fn(), refreshSession: vi.fn(),
  });

afterEach(() => vi.restoreAllMocks());

describe("usePermissions", () => {
  it("offers every action to a superadmin", () => {
    signedInAs({ id: "1", username: "boss", role: "superadmin" });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isSuperadmin).toBe(true);
    expect(result.current.can("delete")).toBe(true);
    expect(result.current.can("changeUserStatus")).toBe(true);
  });

  it("offers a regular administrator only what their switches allow", () => {
    signedInAs({ id: "2", username: "staff", role: "admin", permissions: { add: true, edit: false, delete: false, changeUserStatus: false } });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isSuperadmin).toBe(false);
    expect(result.current.can("add")).toBe(true);
    expect(result.current.can("edit")).toBe(false);
    expect(result.current.can("delete")).toBe(false);
    expect(result.current.can("changeUserStatus")).toBe(false);
  });

  it("keeps today's behaviour for an administrator whose session reports no switches", () => {
    signedInAs({ id: "2", username: "staff", role: "admin" });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("add") && result.current.can("edit") && result.current.can("delete") && result.current.can("changeUserStatus")).toBe(true);
  });

  it("offers nothing without a session", () => {
    signedInAs(null);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isSuperadmin).toBe(false);
    expect(result.current.can("add")).toBe(false);
  });
});
