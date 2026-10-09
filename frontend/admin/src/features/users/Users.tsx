import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { services } from "../../services/api";
import { Badge, Button, Card, Empty, Field, LoadingState, Modal, Pagination, ProgressBar, SelectField, Spinner } from "../../components/UI";
import { FeedbackStack, useFeedback } from "../../components/Feedback";
import { formatDateTime } from "../../lib/format";
import { accountTypeLabel, accountTypes, parseAccountType } from "../../lib/accountType";
import type { AccountStatus, UserAccount, UserAccountType } from "../../types";
import { PageIcon } from "../../components/PageIcon";
import { AdministratorsPanel } from "./AdministratorsPanel";

const ranges = [["all", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"]] as const;

type DirectoryTab = "app" | "admins";

/** App users signed up through the User App. The portal only reads these. */
function AppUserDirectory() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const feedback = useFeedback();
  const [pendingDeactivation, setPendingDeactivation] = useState<UserAccount | null>(null);
  const [statusError, setStatusError] = useState("");
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [createdRange, setCreatedRange] = useState("all");
  const [userType, setUserType] = useState<UserAccountType | "all">(
    () => parseAccountType(searchParams.get("userType")) ?? "all",
  );
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["users", q, createdRange, userType, page],
    queryFn: () => services.users.list(q, page, pageSize, createdRange, userType),
  });
  useEffect(() => setPage(1), [q, createdRange, userType]);
  const result = data ?? { items: [], total: 0, page: 1, pageSize };

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) setActionMenuId(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const setStatus = useMutation({
    mutationFn: ({ user, status }: { user: UserAccount; status: AccountStatus }) =>
      services.users.setStatus(user.id, status),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      feedback.reportSuccess(`${saved.username} was ${saved.status === "Inactive" ? "deactivated" : "activated"} successfully.`);
      setPendingDeactivation(null);
    },
    onError: (cause) => {
      setStatusError(cause instanceof Error ? cause.message : "Unable to update the account's status.");
    },
  });

  /** Restoring access is harmless and immediate; revoking it asks first. */
  const changeStatus = (user: UserAccount) => {
    setActionMenuId(null);
    setStatusError("");
    if (user.status === "Inactive") setStatus.mutate({ user, status: "Active" });
    else setPendingDeactivation(user);
  };

  return (
    <>
      <FeedbackStack messages={feedback.messages} onDismiss={feedback.dismiss} />

      <Card className="filters">
        <Field label="" placeholder="Search by username..." value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="REGISTERED" value={createdRange} onChange={(e) => setCreatedRange(e.target.value)}>
          {ranges.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField
          label="ACCOUNT TYPE"
          className="account-type-filter"
          value={userType}
          onChange={(e) => setUserType(e.target.value as UserAccountType | "all")}
        >
          <option value="all">All</option>
          {accountTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
        </SelectField>
      </Card>

      <Card className="table-card" style={{ overflow: "visible" }}>
        <div className="table-heading">
          <h2>Accounts</h2>
          <p style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {isFetching ? "Loading…" : `Showing ${result.total} users`}
            {isFetching && <Spinner size={13} />}
          </p>
        </div>
        <ProgressBar active={isFetching} />
        <div className="table-wrap" style={{ overflow: "visible" }}>
          <table>
            <thead>
              <tr>
                <th>Username</th><th>Account Type</th><th>Registered On</th><th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.username}</strong></td>
                  <td>{user.userType ? accountTypeLabel(user.userType) : "—"}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td><Badge tone={user.status === "Active" ? "green" : "grey"}>{user.status}</Badge></td>
                  <td style={{ textAlign: "right", position: "relative" }}>
                    <div style={{ display: "inline-flex" }} ref={actionMenuId === user.id ? actionMenuRef : undefined}>
                      <button
                        className="table-action menu-trigger"
                        aria-label={`Actions for ${user.username}`}
                        aria-expanded={actionMenuId === user.id}
                        onClick={() => setActionMenuId((current) => (current === user.id ? null : user.id))}
                      >
                        •••
                      </button>
                      {actionMenuId === user.id && (
                        <div className="row-action-menu" role="menu">
                          {/* An app account's details are the User App's, so
                              the portal offers what it owns: their recorded
                              activity, and whether the account may sign in. */}
                          <button
                            role="menuitem"
                            onClick={() => {
                              setActionMenuId(null);
                              navigate(`/system-logs?${new URLSearchParams({ q: user.username, category: "User" })}`);
                            }}
                          >
                            View activity
                          </button>
                          <button
                            role="menuitem"
                            disabled={setStatus.isPending}
                            onClick={() => changeStatus(user)}
                          >
                            {user.status === "Active" ? "Deactivate account" : "Activate account"}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isFetching
            ? <LoadingState size={20}>Loading users…</LoadingState>
            : !result.items.length && <Empty>No users found.</Empty>}
        </div>
        <Pagination total={result.total} page={page} pageSize={pageSize} onChange={setPage} />
      </Card>

      {pendingDeactivation && (
        <Modal
          title="Deactivate this account?"
          subtitle="The account is kept, but it cannot sign in to the User App."
          size="sm"
          onClose={() => { setPendingDeactivation(null); setStatusError(""); }}
        >
          <p className="admin-remove-copy">
            <strong>{pendingDeactivation.username}</strong> will be refused at the User App's login.
            Their saved history is kept, and you can activate the account again at any time.
          </p>
          {statusError && <div role="alert" className="admin-form-error">{statusError}</div>}
          <div className="modal-actions">
            <Button
              variant="subtle"
              data-modal-initial
              disabled={setStatus.isPending}
              onClick={() => { setPendingDeactivation(null); setStatusError(""); }}
            >
              Cancel
            </Button>
            <Button
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ user: pendingDeactivation, status: "Inactive" })}
            >
              {setStatus.isPending ? "Deactivating…" : "Deactivate Account"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Users() {
  const [tab, setTab] = useState<DirectoryTab>("app");

  return (
    <div className="page users-page">
      <div className="page-hero">
        <PageIcon name="users" />
        <div>
          <h1>User Directory</h1>
          <p>View app users and manage the administrator accounts for this portal.</p>
        </div>
      </div>

      <Card className="table-card user-directory-tabs" style={{ overflow: "visible" }}>
        <div className="tabs">
          <button className={tab === "app" ? "active" : ""} aria-pressed={tab === "app"} onClick={() => setTab("app")}>
            App Users
          </button>
          <button className={tab === "admins" ? "active" : ""} aria-pressed={tab === "admins"} onClick={() => setTab("admins")}>
            Administrators
          </button>
        </div>
        {tab === "admins" && <AdministratorsPanel />}
      </Card>

      {tab === "app" && <AppUserDirectory />}
    </div>
  );
}
