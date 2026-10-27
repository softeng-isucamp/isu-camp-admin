import { useId } from "react";
import { ALWAYS_INCLUDED, PERMISSION_ACTIONS, SUPERADMIN_ONLY } from "../../lib/permissions";
import type { AdminPermissions } from "../../types";

/**
 * The switches of a regular administrator: viewing everything is locked on, then
 * one checkbox per action. One component serves the Add Administrator form, the
 * Edit permissions dialog and the demotion dialog, so they always read the same.
 */
export function PermissionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: AdminPermissions;
  onChange: (next: AdminPermissions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="permissions-editor" disabled={disabled}>
      <legend className="permissions-editor-label">PERMISSIONS</legend>
      <ul className="permissions-editor-options">
        <li className="permissions-editor-option permissions-editor-locked">
          <input type="checkbox" id={`${id}-view`} aria-describedby={`${id}-view-desc`} checked disabled readOnly />
          <label htmlFor={`${id}-view`}>
            <strong>View everything</strong>
            <small id={`${id}-view-desc`}>See every section of the portal. Always included.</small>
          </label>
        </li>
        {PERMISSION_ACTIONS.map(({ key, label, description }) => (
          <li key={key} className="permissions-editor-option">
            <input
              type="checkbox"
              id={`${id}-${key}`}
              aria-describedby={`${id}-${key}-desc`}
              checked={value[key]}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            />
            <label htmlFor={`${id}-${key}`}>
              <strong>{label}</strong>
              <small id={`${id}-${key}-desc`}>{description}</small>
            </label>
          </li>
        ))}
      </ul>
      <p className="permissions-editor-note">
        Always included: {ALWAYS_INCLUDED.join(", ")}. Superadmin only: {SUPERADMIN_ONLY.join(", ")}.
      </p>
    </fieldset>
  );
}
