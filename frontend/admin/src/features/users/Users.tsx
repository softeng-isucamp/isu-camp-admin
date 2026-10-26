import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { services } from "../../services/api";
import { errorMessage } from "../../services/errors";
import { Badge, Button, Card, Empty, Field, LoadingState, Modal, Pagination, ProgressBar, Spinner } from "../../components/UI";
import { FilterCombobox } from "../../components/FilterCombobox";
import { FeedbackStack, useFeedback } from "../../components/Feedback";
import { formatDateTime } from "../../lib/format";
import { accountTypeLabel, accountTypes, parseAccountType } from "../../lib/accountType";
import type { AccountStatus, UserAccount, UserAccountType } from "../../types";
import { PageIcon } from "../../components/PageIcon";
import { AdministratorsPanel } from "./AdministratorsPanel";
import { usePermissions } from "../auth/usePermissions";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

const rangeOptions = [{ id: "7d", name: "Last 7 days" }, { id: "30d", name: "Last 30 days" }, { id: "90d", name: "Last 90 days" }];
const accountTypeOptions = accountTypes.map((type) => ({ id: type.key, name: type.label }));

type DirectoryTab = "app" | "admins";

/** App users signed up through the User App. The portal only reads these. */
function AppUserDirectory() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const feedback = useFeedback();
  const { can } = usePermissions();
  const canChangeStatus = can("changeUserStatus");
  const canChangeStatusRef = useRef(canChangeStatus);
  canChangeStatusRef.current = canChangeStatus;
  const [pendingDeactivation, setPendingDeactivation] = useState<UserAccount | null>(null);
  const [statusError, setStatusError] = useState("");
  useEffect(() => {
    if (canChangeStatus) return;
    setPendingDeactivation(null);
    setStatusError("");
  }, [canChangeStatus]);
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

  // The search waits for typing to pause so a word is one request, not one per key.
  const searchQ = useDebouncedValue(q);
  const { data, isFetching } = useQuery({
    queryKey: ["users", searchQ, createdRange, userType, page],
    queryFn: () => services.users.list(searchQ, page, pageSize, createdRange, userType),
    placeholderData: (previous) => previous,
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
      setStatusError(errorMessage(cause, "The account's status couldn't be updated. Please try again.", { mutation: true }));
    },
  });

  /** Restoring access is harmless and immediate; revoking it asks first. */
  const changeStatus = (user: UserAccount) => {
    if (!canChangeStatusRef.current) return;
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
        <FilterCombobox
          label="REGISTERED"
          noun="date ranges"
          allLabel="All time"
          searchable={false}
          options={rangeOptions}
          value={createdRange === "all" ? null : createdRange}
          onChange={(id) => setCreatedRange(id ?? "all")}
        />
        <FilterCombobox
          label="ACCOUNT TYPE"
          noun="account types"
          allLabel="All"
          searchable={false}
          options={accountTypeOptions}
          value={userType === "all" ? null : userType}
          onChange={(id) => setUserType(id === null ? "all" : (id as UserAccountType))}
        />
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
                              activity, and whether the account may sign in
                              (an administrator without that switch is only
                              offered the activity). */}
                          <button
                            role="menuitem"
                            onClick={() => {
                              setActionMenuId(null);
                              navigate(`/system-logs?${new URLSearchParams({ q: user.username, category: "User" })}`);
                            }}
                          >
                            View activity
                          </button>
                          {can("changeUserStatus") && (
                            <button
                              role="menuitem"
                              disabled={setStatus.isPending}
                              onClick={() => changeStatus(user)}
                            >
                              {user.status === "Active" ? "Deactivate account" : "Activate account"}
                            </button>
                          )}
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

      {pendingDeactivation && canChangeStatus && (
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
              onClick={() => {
                if (canChangeStatusRef.current) setStatus.mutate({ user: pendingDeactivation, status: "Inactive" });
              }}
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
  const { isSuperadmin } = usePermissions();
  const adminFeedback = useFeedback();
  // `?tab=admins` opens the Administrators tab so the link can be shared. The tab is a superadmin's:
  // anyone else lands on App Users, whatever the address says.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: DirectoryTab = isSuperadmin && searchParams.get("tab") === "admins" ? "admins" : "app";
  const setTab = (next: DirectoryTab) => setSearchParams((params) => {
    const updated = new URLSearchParams(params);
    updated.set("tab", next);
    return updated;
  }, { replace: true });

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
          {isSuperadmin && (
            <button className={tab === "admins" ? "active" : ""} aria-pressed={tab === "admins"} onClick={() => setTab("admins")}>
              Administrators
            </button>
          )}
        </div>
        {tab === "admins" && <AdministratorsPanel feedback={adminFeedback} />}
      </Card>
      <FeedbackStack messages={adminFeedback.messages} onDismiss={adminFeedback.dismiss} />

      {tab === "app" && <AppUserDirectory />}
    </div>
  );
}
