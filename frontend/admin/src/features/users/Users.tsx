import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { services } from "../../services/api";
import { Card, Empty, Field, LoadingState, Pagination, ProgressBar, SelectField, Spinner } from "../../components/UI";
import { formatDateTime } from "../../lib/format";
import { accountTypeLabel, accountTypes, parseAccountType } from "../../lib/accountType";
import type { UserAccountType } from "../../types";
import { PageIcon } from "../../components/PageIcon";
import { AdministratorsPanel } from "./AdministratorsPanel";

const ranges = [["all", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"]] as const;

type DirectoryTab = "app" | "admins";

/** App users signed up through the User App. The portal only reads these. */
function AppUserDirectory() {
  const navigate = useNavigate();
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

  return (
    <>
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
                <th>Username</th><th>Account Type</th><th>Registered On</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.username}</strong></td>
                  <td>{user.userType ? accountTypeLabel(user.userType) : "—"}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
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
                          {/* App accounts belong to the User App, so the portal
                              offers what it owns: their recorded activity. */}
                          <button
                            role="menuitem"
                            onClick={() => {
                              setActionMenuId(null);
                              navigate(`/system-logs?${new URLSearchParams({ q: user.username, category: "User" })}`);
                            }}
                          >
                            View activity
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
