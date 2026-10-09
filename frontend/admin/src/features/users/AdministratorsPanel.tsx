import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Empty, Field, LoadingState, Modal, ProgressBar } from "../../components/UI";
import { FeedbackStack, useFeedback } from "../../components/Feedback";
import { PasswordConfirmationField, usePasswordConfirmation } from "../auth/PasswordConfirmation";
import { services } from "../../services/api";
import type { AdminAccount, AdminAccountDraft } from "../../types";

const blankDraft = (): AdminAccountDraft => ({ username: "", email: "", password: "" });

type Dialog =
  | { kind: "add" }
  | { kind: "deactivate"; account: AdminAccount }
  | { kind: "reset"; account: AdminAccount }
  | { kind: "remove"; account: AdminAccount }
  | null;

/**
 * Administrator accounts for the portal itself. Unlike the app users beside
 * them — owned by the User App — these are this app's own records, so they can
 * be added, deactivated and removed here.
 *
 * Editing is deliberately absent: sign-in details belong to their holder, so
 * each administrator changes their own through account customization rather
 * than through this directory. What the row offers instead are the things one
 * administrator can legitimately do about another — read their recorded
 * activity, revoke or restore their access, mail them a reset code, or remove
 * them outright. Deactivating is the reversible one, and usually the right one:
 * the account and its audit trail survive, only the sign-in stops.
 */
export function AdministratorsPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const feedback = useFeedback();
  const passwordConfirmation = usePasswordConfirmation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<AdminAccountDraft>(blankDraft());
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
    setDialog(null);
    setDraft(blankDraft());
    setError("");
    setFieldErrors({});
    passwordConfirmation.reset();
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admins"] });

  const reportFailure = (cause: unknown, fallback: string) => {
    const fields = (cause as Error & { fieldErrors?: Record<string, string> }).fieldErrors;
    if (fields && Object.keys(fields).length) setFieldErrors(fields);
    setError(cause instanceof Error ? cause.message : fallback);
  };

  const save = useMutation({
    mutationFn: (values: AdminAccountDraft) => services.admins.save(values),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(`${saved.username} was added successfully.`);
      closeDialog();
    },
    onError: (cause) => reportFailure(cause, "Unable to save the administrator."),
  });

  const setStatus = useMutation({
    mutationFn: ({ account, status }: { account: AdminAccount; status: AdminAccount["status"] }) =>
      services.admins.setStatus(account.id, status),
    onSuccess: async (saved) => {
      await refresh();
      feedback.reportSuccess(`${saved.username} was ${saved.status === "Inactive" ? "deactivated" : "activated"} successfully.`);
      closeDialog();
    },
    onError: (cause) => reportFailure(cause, "Unable to update the administrator's status."),
  });

  const sendReset = useMutation({
    mutationFn: (account: AdminAccount) => services.admins.sendPasswordReset(account.id),
    onSuccess: (message) => {
      feedback.reportSuccess(message);
      closeDialog();
    },
    onError: (cause) => reportFailure(cause, "Unable to send the password reset code."),
  });

  const remove = useMutation({
    mutationFn: (account: AdminAccount) => services.admins.remove(account.id),
    onSuccess: async (_result, account) => {
      await refresh();
      feedback.reportSuccess(`${account.username} was removed successfully.`);
      closeDialog();
    },
    onError: (cause) => {
      if (passwordConfirmation.handleRejection(cause)) return;
      reportFailure(cause, "Unable to remove the administrator.");
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

  const submitDraft = () => {
    setError("");
    setFieldErrors({});
    const username = draft.username.trim();
    const email = draft.email.trim();
    const issues: Record<string, string> = {};
    if (!username) issues.username = "Username is required.";
    if (!email) issues.email = "Email is required.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) issues.email = "Enter a valid email address.";
    if ((draft.password ?? "").length < 8) {
      issues.password = "Password must be at least 8 characters.";
    }
    if (Object.keys(issues).length) {
      setFieldErrors(issues);
      return;
    }
    save.mutate({ ...draft, username, email });
  };

  const confirmRemoval = async (account: AdminAccount) => {
    setError("");
    if (!await passwordConfirmation.confirm()) return;
    remove.mutate(account);
  };

  return (
    <>
      <FeedbackStack messages={feedback.messages} onDismiss={feedback.dismiss} />

      <div className="table-heading">
        <div>
          <h2>Administrators</h2>
          <p>Portal accounts that can sign in and manage campus data.</p>
        </div>
        <Button onClick={() => { setDraft(blankDraft()); setFieldErrors({}); setError(""); setDialog({ kind: "add" }); }}>
          ＋ Add Administrator
        </Button>
      </div>

      <ProgressBar active={isFetching && !isLoading} />

      {listError && !dialog && (
        <div role="alert" className="admin-table-error">
          Unable to load administrator accounts. {listError instanceof Error ? listError.message : "The service returned an error."}
        </div>
      )}

      <div className="table-wrap" style={{ overflow: "visible" }}>
        <table>
          <thead>
            <tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr>
          </thead>
          <tbody>
            {admins.map((account) => (
              <tr key={account.id}>
                <td><strong>{account.username}</strong></td>
                <td>{account.email || "—"}</td>
                <td>
                  <Badge tone={account.isCurrent ? "green" : "grey"}>
                    {account.isCurrent ? "Administrator · You" : "Administrator"}
                  </Badge>
                </td>
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
                        <button
                          role="menuitem"
                          disabled={account.isCurrent || setStatus.isPending}
                          title={account.isCurrent ? "You cannot deactivate your own account." : undefined}
                          onClick={() => changeStatus(account)}
                        >
                          {account.status === "Active" ? "Deactivate account" : "Activate account"}
                        </button>
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
                        <button
                          role="menuitem"
                          className="danger"
                          disabled={account.isCurrent || admins.length <= 1}
                          title={account.isCurrent
                            ? "You cannot remove your own account."
                            : admins.length <= 1 ? "The last administrator cannot be removed." : undefined}
                          onClick={() => {
                            setError("");
                            passwordConfirmation.reset();
                            setDialog({ kind: "remove", account });
                            setActionMenuId(null);
                          }}
                        >
                          Remove administrator
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

      {dialog?.kind === "add" && (
        <Modal
          title="Add Administrator"
          subtitle="This account can sign in to the admin portal."
          size="sm"
          onClose={closeDialog}
        >
          <div className="admin-form">
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
              subhelper="At least 8 characters."
              value={draft.password ?? ""}
              error={fieldErrors.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </div>
          <div className="modal-actions">
            <Button variant="subtle" disabled={save.isPending} onClick={closeDialog}>Cancel</Button>
            <Button loading={save.isPending} onClick={submitDraft}>
              {save.isPending ? "Saving…" : "Add Administrator"}
            </Button>
          </div>
        </Modal>
      )}

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

      {dialog?.kind === "remove" && (
        <Modal
          title="Remove administrator?"
          subtitle="This permanently removes the account's access to the portal."
          size="sm"
          variant="danger"
          onClose={closeDialog}
        >
          <p className="admin-remove-copy">
            <strong>{dialog.account.username}</strong> will no longer be able to sign in. This cannot be undone.
          </p>
          {error && <div role="alert" className="admin-form-error">{error}</div>}
          <PasswordConfirmationField
            confirmation={passwordConfirmation}
            disabled={remove.isPending}
            onSubmit={() => void confirmRemoval(dialog.account)}
          />
          <div className="modal-actions">
            <Button
              variant="subtle"
              data-modal-initial
              disabled={remove.isPending || passwordConfirmation.confirming}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending || passwordConfirmation.confirming}
              onClick={() => void confirmRemoval(dialog.account)}
            >
              {remove.isPending ? "Removing…" : passwordConfirmation.confirming ? "Confirming…" : "Remove Administrator"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
