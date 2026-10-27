import type { AdminPermissionAction, AdminPermissions, AdminRole } from "../types";

/**
 * Portal-wide switches for regular administrators. Viewing is always allowed and
 * has no switch: no section, page, nav item or Dashboard card is ever hidden by
 * these. A switched-off action is hidden, not disabled, and a menu left with
 * nothing in it is hidden with its trigger.
 *
 * The server is the authority; this only decides what the signed-in admin is offered.
 */
export const PERMISSION_ACTIONS: ReadonlyArray<{ key: AdminPermissionAction; label: string; description: string }> = [
  { key: "add", label: "Add", description: "Create locations, rooms, buildings, route nodes and pathways." },
  { key: "edit", label: "Edit", description: "Change details, reshape footprints and move points." },
  { key: "delete", label: "Delete", description: "Delete locations, buildings, route nodes and pathways." },
  { key: "changeUserStatus", label: "Change app user status", description: "Activate or deactivate app user accounts." },
];

/** What every administrator keeps whatever the switches say; shown under the editor. */
export const ALWAYS_INCLUDED = ["Dashboard", "My Profile"];
/** What no switch grants; shown under the editor. */
export const SUPERADMIN_ONLY = ["Backup & Recovery", "Managing administrators"];

export const allPermissions = (): AdminPermissions => ({ add: true, edit: true, delete: true, changeUserStatus: true });
/** Where a new or demoted administrator starts. */
export const viewOnlyPermissions = (): AdminPermissions => ({ add: false, edit: false, delete: false, changeUserStatus: false });

export const samePermissions = (a: AdminPermissions, b: AdminPermissions) =>
  PERMISSION_ACTIONS.every(({ key }) => a[key] === b[key]);

/**
 * Reads the switches off a backend record. Anything that is not an object means
 * "not reported" (undefined); inside an object, only an explicit `true` grants.
 */
export function readPermissions(raw: unknown): AdminPermissions | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  return Object.fromEntries(PERMISSION_ACTIONS.map(({ key }) => [key, record[key] === true])) as unknown as AdminPermissions;
}

/**
 * Whether an administrator may do an action. A superadmin always may. A regular
 * administrator follows their switch, and a backend that does not report switches
 * (yet) leaves everything allowed, as before this feature.
 */
export function canPerform(
  admin: { role?: AdminRole; permissions?: AdminPermissions } | null | undefined,
  action: AdminPermissionAction,
): boolean {
  if (!admin) return false;
  if (admin.role === "superadmin") return true;
  return admin.permissions ? admin.permissions[action] === true : true;
}

export type CanPerform = (action: AdminPermissionAction) => boolean;
