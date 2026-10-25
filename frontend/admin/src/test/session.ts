import { vi } from "vitest";
import * as AuthContext from "../features/auth/AuthContext";
import type { AdminPermissions, AdminRole } from "../types";

/**
 * Signs components in as an administrator without a provider, for tests that
 * render one screen. `permissions` are a regular administrator's switches;
 * leave them out for a session that reports none. Restore with `vi.restoreAllMocks()`.
 */
export function signInAs(role: AdminRole | undefined, options: { username?: string; permissions?: AdminPermissions } = {}) {
  const { username = "admin_justine", permissions } = options;
  return vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    session: { id: "1", username, ...(role ? { role } : {}), ...(permissions ? { permissions } : {}) },
    login: vi.fn(),
    logout: vi.fn(),
    loading: false,
    updateSession: vi.fn(),
    refreshSession: vi.fn(),
  });
}
