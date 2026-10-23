import { useAuth } from "./AuthContext";
import { canPerform, type CanPerform } from "../../lib/permissions";

/** The signed-in administrator's `can(action)` check: the one gate every Add, Edit, Delete and status control uses. */
export function usePermissions(): { can: CanPerform; isSuperadmin: boolean } {
  const { session } = useAuth();
  return {
    can: (action) => canPerform(session, action),
    isSuperadmin: session?.role === "superadmin",
  };
}
