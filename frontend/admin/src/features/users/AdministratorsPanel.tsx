import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Empty, Field, LoadingState, Modal, ProgressBar, SelectField } from "../../components/UI";
import type { useFeedback } from "../../components/Feedback";
import { PasswordChecklist } from "../../components/PasswordChecklist";
import { PasswordConfirmationField, usePasswordConfirmation, type PasswordConfirmationWording } from "../auth/PasswordConfirmation";
import { useAuth } from "../auth/AuthContext";
import { services } from "../../services/api";
import { errorMessage, SuperadminRequiredError } from "../../services/errors";
import { firstPasswordIssue } from "../../services/passwordRules";
import { PERMISSION_ACTIONS, allPermissions, samePermissions, viewOnlyPermissions } from "../../lib/permissions";
import type { AdminAccount, AdminAccountDraft, AdminPermissions, AdminRole } from "../../types";
import { PermissionsEditor } from "./PermissionsEditor";

const ROLE_LABELS: Record<AdminAccount["role"], string> = { admin: "Administrator", superadmin: "Superadmin" };

const ROLE_CHANGE_WORDING: PasswordConfirmationWording = {
  missing: "Enter your password to confirm this role change.",
  expired: "Your password confirmation expired. Enter it again to change this role.",
  hint: "Changing a role needs your password.",
};

const CREATE_ADMIN_WORDING: PasswordConfirmationWording = {
  missing: "Enter your password to confirm adding this account.",
  expired: "Your password confirmation expired. Enter it again to add this account.",
  hint: "Adding an administrator needs your password.",
};

const PERMISSIONS_WORDING: PasswordConfirmationWording = {
  missing: "Enter your password to confirm these permissions.",
  expired: "Your password confirmation expired. Enter it again to save these permissions.",
  hint: "Changing permissions needs your password.",
};

/** What a row's Permissions cell says: a superadmin has everything, and no report from the backend means everything too. */
const permissionsSummary = (account: AdminAccount): string => {
  if (account.role === "superadmin") return "All permissions";
  const switches = account.permissions ?? allPermissions();
  const granted = PERMISSION_ACTIONS.filter(({ key }) => switches[key]).map(({ label }) => label);
  if (granted.length === PERMISSION_ACTIONS.length) return "All permissions";
  return granted.length ? `View + ${granted.join(", ")}` : "View only";
};

const blankDraft = (): AdminAccountDraft => ({ username: "", email: "", password: "", role: "admin" });

type Dialog =
  | { kind: "add" }
  | { kind: "deactivate"; account: AdminAccount }
  | { kind: "reset"; account: AdminAccount }
  | { kind: "permissions"; account: AdminAccount }
  | { kind: "role"; account: AdminAccount; role: AdminRole }
  | null;

/**
 * Administrator accounts for the portal itself. Unlike the app users beside
 * them — owned by the User App — these are this app's own records, so they can
 * be added, activated and deactivated here.
 *
 * Editing is deliberately absent: sign-in details belong to their holder, so
 * each administrator changes their own through account customization rather
 * than through this directory. What the row offers instead are the things one
 * administrator can legitimately do about another — read their recorded
 * activity, revoke or restore their access, mail them a reset code, or change
 * what a regular administrator may do. There is no removal: deactivating is the
 * replacement, because the account and its audit trail survive and only the
 * sign-in stops.
 *
 * The whole tab is a superadmin's: the Users page leaves it out for anyone else.
 * The server refuses these requests for other roles too — the viewer's role only
 * decides what is offered. A superadmin adds accounts, promotes and demotes other
 * accounts and edits a regular administrator's permissions here, each after
 * retyping their own password; nobody changes their own role or permissions, and
 * a superadmin has every permission, so there is nothing to edit until they are
 * demoted.
 */
export function AdministratorsPanel({ feedback }: {
  /**
   * Owned by the page, so a message outlives this panel: a refused request ends in a demoted
   * session, which removes the tab (and this panel) while the reason is still being read.
   */
  feedback: ReturnType<typeof useFeedback>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, refreshSession } = useAuth();
  const canManage = session?.role === "superadmin";
  const [dialog, setDialog] = useState<Dialog>(null);
  const submissionGeneration = useRef(0);
  const submissionContext = useRef({ session, dialog });
  submissionContext.current = { session, dialog };
  // A confirmation may outlive this panel or the session that opened it.
  useEffect(() => () => { submissionGeneration.current += 1; }, [session]);
  const passwordConfirmation = usePasswordConfirmation(
    dialog?.kind === "role" ? ROLE_CHANGE_WORDING
      : dialog?.kind === "add" ? CREATE_ADMIN_WORDING
        : dialog?.kind === "permissions" ? PERMISSIONS_WORDING : undefined,
  );
  const [draft, setDraft] = useState<AdminAccountDraft>(blankDraft());
  // The switches the open dialog is editing: a new administrator's, an existing one's, or a demoted superadmin's.
  const [permissions, setPermissions] = useState<AdminPermissions>(viewOnlyPermissions());
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isFetching, error: listError } = useQuery({
    queryKey: ["admins"],
    queryFn: () => services.admins.list(),
  });
  const admins = data ?? [];

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) setActionMenuId(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const closeDialog = () => {
    submissionGeneration.current += 1;
    setDialog(null);
    setDraft(blankDraft());
    setPermissions(viewOnlyPermissions());
    setError("");
    setFieldErrors({});
    passwordConfirmation.reset();
  };

  /** Opens a dialog with a clean slate; `switches` seeds the editor in the dialogs that have one. */
  const openDialog = (next: NonNullable<Dialog>, switches: AdminPermissions = viewOnlyPermissions()) => {
    submissionGeneration.current += 1;
    setError("");
    setFieldErrors({});
    passwordConfirmation.reset();
    setPermissions(switches);
    setActionMenuId(null);
    setDialog(next);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admins"] });

  const reportFailure = (cause: unknown, fallback: string) => {
    const fields = (cause as Error & { fieldErrors?: Record<string, string> }).fieldErrors;
    if (fields && Object.keys(fields).length) setFieldErrors(fields);
    const message = errorMessage(cause, fallback, { mutation: true });
    // A message the form already shows under its field is not repeated in the banner.
    setError(fields && Object.values(fields).includes(message) ? "" : message);
  };

  /**
   * A superadmin refusal means this page is acting on a role the account no longer
   * holds. Say so, drop whatever dialog was open, and read the session and the list
   * again so the controls match what the server will allow. It goes to the page's
   * feedback stack because closing the dialog discards the dialog's own error line.
   */
  const recoverFromSuperadminRefusal = (cause: unknown) => {
    if (!(cause instanceof SuperadminRequiredError)) return false;
    closeDialog();
    feedback.reportError(cause.message);
    void refreshSession();
    void refresh();
    return true;
  };

  const save = useMutation({
    mutationFn: (values: AdminAccountDraft) => services.admins.save(values),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(`${saved.username} was added successfully.`);
      closeDialog();
    },
    onError: (cause) => {
      if (recoverFromSuperadminRefusal(cause) || passwordConfirmation.handleRejection(cause)) return;
      reportFailure(cause, "The administrator couldn't be saved. Please try again.");
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ account, status }: { account: AdminAccount; status: AdminAccount["status"] }) =>
      services.admins.setStatus(account.id, status),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(`${saved.username} was ${saved.status === "Inactive" ? "deactivated" : "activated"} successfully.`);
      closeDialog();
    },
    onError: (cause) => {
      if (recoverFromSuperadminRefusal(cause)) return;
      reportFailure(cause, "The administrator's status couldn't be updated. Please try again.");
    },
  });

  const sendReset = useMutation({
    mutationFn: (account: AdminAccount) => services.admins.sendPasswordReset(account.id),
    onSuccess: (message) => {
      feedback.reportSuccess(message);
      closeDialog();
    },
    onError: (cause) => reportFailure(cause, "The password reset code couldn't be sent. Please try again."),
  });

  const savePermissions = useMutation({
    mutationFn: ({ account, switches }: { account: AdminAccount; switches: AdminPermissions }) =>
      services.admins.setPermissions(account.id, switches),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(`${saved.username}'s permissions were updated successfully.`);
      closeDialog();
    },
    onError: (cause) => {
      if (recoverFromSuperadminRefusal(cause) || passwordConfirmation.handleRejection(cause)) return;
      reportFailure(cause, "The administrator's permissions couldn't be updated. Please try again.");
    },
  });

  const setRole = useMutation({
    mutationFn: ({ account, role, switches }: { account: AdminAccount; role: AdminRole; switches?: AdminPermissions }) =>
      switches ? services.admins.setRole(account.id, role, switches) : services.admins.setRole(account.id, role),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(
        `${saved.username} was ${saved.role === "superadmin" ? "promoted to superadmin" : "demoted to administrator"} successfully.`,
      );
      closeDialog();
    },
    onError: (cause) => {
      if (recoverFromSuperadminRefusal(cause) || passwordConfirmation.handleRejection(cause)) return;
      reportFailure(cause, "The administrator's role couldn't be changed. Please try again.");
    },
  });

  const viewActivity = (account: AdminAccount) => {
    setActionMenuId(null);
    navigate(`/system-logs?${new URLSearchParams({ q: account.username, category: "Admin" })}`);
  };

  /** Restoring access is harmless and immediate; revoking it asks first. */
  const changeStatus = (account: AdminAccount) => {
    setActionMenuId(null);
    setError("");
    if (account.status === "Inactive") setStatus.mutate({ account, status: "Active" });
    else setDialog({ kind: "deactivate", account });
  };

  const confirmSubmission = async () => {
    if (!dialog || !canManage) return false;
    const generation = ++submissionGeneration.current;
    if (!await passwordConfirmation.confirm()) return false;
    const current = submissionContext.current;
    return generation === submissionGeneration.current
      && current.dialog === dialog && current.session === session;
  };

  const submitDraft = async () => {
    setError("");
    setFieldErrors({});
    const username = draft.username.trim();
    const email = draft.email.trim();
    const issues: Record<string, string> = {};
    if (!username) issues.username = "Username is required.";
    if (!email) issues.email = "Email is required.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) issues.email = "Enter a valid email address.";
    const weakness = firstPasswordIssue(draft.password ?? "");
    if (weakness) issues.password = weakness;
    if (Object.keys(issues).length) {
      setFieldErrors(issues);
      return;
    }
    // Adding any administrator is guarded like promoting one; the form keeps its details if the password is refused.
    if (!await confirmSubmission()) return;
    save.mutate({ ...draft, username, email, ...(draft.role === "admin" ? { permissions } : {}) });
  };

  const confirmPermissions = async (account: AdminAccount) => {
    setError("");
    if (!await confirmSubmission()) return;
    savePermissions.mutate({ account, switches: permissions });
  };

  const confirmRoleChange = async (account: AdminAccount, role: AdminRole) => {
    setError("");
    if (!await confirmSubmission()) return;
    // The switches only mean something to an administrator, so a promotion sends none.
    setRole.mutate({ account, role, ...(role === "admin" ? { switches: permissions } : {}) });
  };

  return (
    <>
      <div className="table-heading">
        <div>
          <h2>Administrators</h2>
          <p>Portal accounts that can sign in and manage campus data.</p>
        </div>
        {canManage && (
          <Button onClick={() => { setDraft(blankDraft()); openDialog({ kind: "add" }); }}>
            ＋ Add Administrator
          </Button>
        )}
      </div>

      <ProgressBar active={isFetching && !isLoading} />

      {listError && !dialog && (
        <div role="alert" className="admin-table-error">
          {errorMessage(listError, "Administrator accounts couldn't be loaded. Please try again.")}
        </div>
      )}

      <div className="table-wrap" style={{ overflow: "visible" }}>
        <table>
          <thead>
            <tr><th>Username</th><th>Email</th><th>Role</th><th>Permissions</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr>
          </thead>
          <tbody>
            {admins.map((account) => (
              <tr key={account.id}>
                <td><strong>{account.username}</strong></td>
                <td>{account.email || "—"}</td>
                <td>
                  <Badge tone={account.isCurrent ? "green" : "grey"}>
                    {ROLE_LABELS[account.role]}{account.isCurrent && " · You"}
                  </Badge>
                </td>
                <td>{permissionsSummary(account)}</td>
                <td>
                  <Badge tone={account.status === "Active" ? "green" : "grey"}>{account.status}</Badge>
                </td>
                <td style={{ textAlign: "right", position: "relative" }}>
                  <div
                    style={{ display: "inline-flex" }}
                    ref={actionMenuId === account.id ? actionMenuRef : undefined}
                  >
                    <button
                      className="table-action menu-trigger"
                      aria-label={`Actions for ${account.username}`}
                      aria-expanded={actionMenuId === account.id}
                      onClick={() => setActionMenuId((current) => (current === account.id ? null : account.id))}
                    >
                      •••
                    </button>
                    {actionMenuId === account.id && (
                      <div className="row-action-menu" role="menu">
                        <button role="menuitem" onClick={() => viewActivity(account)}>
                          View activity
                        </button>
                        {canManage && account.role === "admin" && !account.isCurrent && (
                          <button
                            role="menuitem"
                            onClick={() => openDialog({ kind: "permissions", account }, account.permissions ?? allPermissions())}
                          >
                            Edit permissions
                          </button>
                        )}
                        {canManage && (
                          <button
                            role="menuitem"
                            disabled={account.isCurrent || setStatus.isPending}
                            title={account.isCurrent ? "You cannot deactivate your own account." : undefined}
                            onClick={() => changeStatus(account)}
                          >
                            {account.status === "Active" ? "Deactivate account" : "Activate account"}
                          </button>
                        )}
                        {canManage && (
                          <button
                            role="menuitem"
                            disabled={account.isCurrent}
                            title={account.isCurrent ? "You cannot change your own role." : undefined}
                            // A demoted superadmin starts view only; the dialog's editor lets the superadmin turn things on.
                            onClick={() => openDialog({ kind: "role", account, role: account.role === "superadmin" ? "admin" : "superadmin" })}
                          >
                            {account.role === "superadmin" ? "Make administrator" : "Make superadmin"}
                          </button>
                        )}
                        {/* Helps a locked-out colleague without touching their
                            account: the code only reaches their own inbox. */}
                        <button
                          role="menuitem"
                          disabled={!account.email}
                          title={account.email ? undefined : "No email address on file."}
                          onClick={() => {
                            setError("");
                            setDialog({ kind: "reset", account });
                            setActionMenuId(null);
                          }}
                        >
                          Send password reset code
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading ? <LoadingState size={20}>Loading administrators…</LoadingState>
          : !admins.length && !listError && <Empty>No administrator accounts found.</Empty>}
      </div>

      {dialog?.kind === "add" && (() => {
        const isAdmin = draft.role === "admin";
        const busy = save.isPending || passwordConfirmation.confirming;
        const identityFields = (
          <>
            {error && <div role="alert" className="admin-form-error">{error}</div>}
            <Field
              label="USERNAME"
              aria-label="Username"
              required
              autoComplete="off"
              value={draft.username}
              error={fieldErrors.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
            <Field
              label="EMAIL"
              aria-label="Email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@isu.edu.ph"
              subhelper="Password reset codes are sent here."
              value={draft.email}
              error={fieldErrors.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <Field
              label="PASSWORD"
              aria-label="Password"
              type="password"
              required
              autoComplete="new-password"
              value={draft.password ?? ""}
              error={fieldErrors.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
            <PasswordChecklist password={draft.password ?? ""} />
            <SelectField
              label="ROLE"
              aria-label="Role"
              value={draft.role}
              error={fieldErrors.role}
              disabled={busy}
              subhelper={isAdmin
                ? "New administrators start with view only. Turn on what they need."
                : "Superadmins have every permission, manage administrators and run backups."}
              onChange={(event) => {
                setDraft({ ...draft, role: event.target.value as AdminRole });
                setFieldErrors({ ...fieldErrors, role: "" });
                // The password typed for the confirmation is not carried across a change of role.
                passwordConfirmation.reset();
              }}
            >
              <option value="admin">Administrator</option>
              <option value="superadmin">Superadmin</option>
            </SelectField>
          </>
        );
        const confirmationField = (
          <PasswordConfirmationField
            confirmation={passwordConfirmation}
            disabled={save.isPending}
            onSubmit={() => void submitDraft()}
          />
        );
        return (
          <Modal
            title="Add Administrator"
            subtitle="This account can sign in to the admin portal."
            size="lg"
            onClose={closeDialog}
          >
            <div className="admin-form admin-form-columns">
              <div className="admin-form-column">{identityFields}</div>
              <div className="admin-form-column">
                <PermissionsEditor
                  value={isAdmin ? permissions : allPermissions()}
                  onChange={setPermissions}
                  disabled={busy || !isAdmin}
                />
                {confirmationField}
              </div>
            </div>
            <div className="modal-actions">
              <Button variant="subtle" disabled={busy} onClick={closeDialog}>Cancel</Button>
              <Button loading={busy} onClick={() => void submitDraft()}>
                {save.isPending ? "Saving…" : passwordConfirmation.confirming ? "Confirming…" : "Add Administrator"}
              </Button>
            </div>
          </Modal>
        );
      })()}

      {dialog?.kind === "permissions" && (() => {
        const { account } = dialog;
        const original = account.permissions ?? allPermissions();
        const busy = savePermissions.isPending || passwordConfirmation.confirming;
        return (
          <Modal
            title="Edit permissions"
            subtitle={`What ${account.username} can do in the portal.`}
            size="md"
            onClose={closeDialog}
          >
            <div className="admin-form">
              {error && <div role="alert" className="admin-form-error">{error}</div>}
              <PermissionsEditor value={permissions} onChange={setPermissions} disabled={busy} />
              <PasswordConfirmationField
                confirmation={passwordConfirmation}
                disabled={savePermissions.isPending}
                onSubmit={() => void confirmPermissions(account)}
              />
            </div>
            <div className="modal-actions">
              <Button variant="subtle" data-modal-initial disabled={busy} onClick={closeDialog}>Cancel</Button>
              <Button
                loading={busy}
                disabled={samePermissions(original, permissions)}
                onClick={() => void confirmPermissions(account)}
              >
                {savePermissions.isPending ? "Saving…" : passwordConfirmation.confirming ? "Confirming…" : "Save Permissions"}
              </Button>
            </div>
          </Modal>
        );
      })()}

      {dialog?.kind === "deactivate" && (
        <Modal
          title="Deactivate this administrator?"
          subtitle="They keep their account, but cannot sign in until it is reactivated."
          size="sm"
          onClose={closeDialog}
        >
          <p className="admin-remove-copy">
            <strong>{dialog.account.username}</strong> will be signed out and refused at the login
            page. Their activity in System Logs is kept, and you can activate the account again at
            any time.
          </p>
          {error && <div role="alert" className="admin-form-error">{error}</div>}
          <div className="modal-actions">
            <Button variant="subtle" data-modal-initial disabled={setStatus.isPending} onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ account: dialog.account, status: "Inactive" })}
            >
              {setStatus.isPending ? "Deactivating…" : "Deactivate Account"}
            </Button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "reset" && (
        <Modal
          title="Send a password reset code?"
          subtitle="The code goes to the account's own email address."
          size="sm"
          onClose={closeDialog}
        >
          <p className="admin-remove-copy">
            <strong>{dialog.account.username}</strong> will receive a six-digit code at{" "}
            <strong>{dialog.account.email}</strong>, valid for 10 minutes. You will not see the code —
            they use it to set a new password themselves.
          </p>
          {error && <div role="alert" className="admin-form-error">{error}</div>}
          <div className="modal-actions">
            <Button variant="subtle" data-modal-initial disabled={sendReset.isPending} onClick={closeDialog}>
              Cancel
            </Button>
            <Button loading={sendReset.isPending} onClick={() => sendReset.mutate(dialog.account)}>
              {sendReset.isPending ? "Sending…" : "Send Reset Code"}
            </Button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "role" && (
        <Modal
          title={dialog.role === "superadmin" ? "Make superadmin?" : "Make administrator?"}
          subtitle={dialog.role === "superadmin"
            ? "This gives the account every permission and control of administrator accounts."
            : "This withdraws the account's control of administrator accounts."}
          size={dialog.role === "superadmin" ? "sm" : "md"}
          onClose={closeDialog}
        >
          <p className="admin-remove-copy">
            {dialog.role === "superadmin" ? (
              <>
                <strong>{dialog.account.username}</strong> will be able to add and deactivate administrators, edit permissions and
                change roles, yours included, and will run backups. Their current permission switches are discarded.
                Only grant this to someone you trust with that control.
              </>
            ) : (
              <>
                <strong>{dialog.account.username}</strong> keeps their account and can still sign in. They can no longer see
                this list, add or deactivate administrators, change roles or run backups — their next attempt will be
                refused. They start with view only; turn on what they still need.
              </>
            )}
          </p>
          {error && <div role="alert" className="admin-form-error">{error}</div>}
          {dialog.role === "admin" && (
            <PermissionsEditor
              value={permissions}
              onChange={setPermissions}
              disabled={setRole.isPending || passwordConfirmation.confirming}
            />
          )}
          <PasswordConfirmationField
            confirmation={passwordConfirmation}
            disabled={setRole.isPending}
            onSubmit={() => void confirmRoleChange(dialog.account, dialog.role)}
          />
          <div className="modal-actions">
            <Button
              variant="subtle"
              data-modal-initial
              disabled={setRole.isPending || passwordConfirmation.confirming}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              loading={setRole.isPending || passwordConfirmation.confirming}
              onClick={() => void confirmRoleChange(dialog.account, dialog.role)}
            >
              {setRole.isPending ? "Updating…" : passwordConfirmation.confirming ? "Confirming…"
                : dialog.role === "superadmin" ? "Make Superadmin" : "Make Administrator"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
