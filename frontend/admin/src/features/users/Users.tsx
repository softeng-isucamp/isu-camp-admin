import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import {
  Button,
  Card,
  Empty,
  Field,
  Modal,
  Pagination,
  SelectField,
} from "../../components/UI";
import type { UserAccount } from "../../types";
import { users as initialUsers } from "../../services/mockData";
import usersModuleIcon from "../../assets/figma/modules/users.svg";

export function Users() {
  const queryClient = useQueryClient();
  const routeLocation = useLocation();

  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "userUpdate") {
      setMockFailure("userUpdate", true);
      return () => setMockFailure("userUpdate", false);
    }
    return undefined;
  }, []);

  const [query, setQuery] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(routeLocation.search).get("q");
    if (q !== null) setQuery(q);
  }, [routeLocation.search]);

  const [dialog, setDialog] = useState<
    "add" | "edit" | "history" | "reset" | "remove" | null
  >(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [selected, setSelected] = useState<UserAccount | null>(null);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserAccount["role"]>("User");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data } = useQuery({
    queryKey: ["users", query],
    queryFn: () => services.users.list(query),
  });

  const rawUsers = data?.items ?? initialUsers;
  const filteredUsers = query.trim()
    ? rawUsers.filter((u) => u.username.toLowerCase().includes(query.trim().toLowerCase()))
    : rawUsers;

  const close = () => setDialog(null);
  const visibleUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query]);

  const openEdit = (user: UserAccount) => {
    setSelected(user);
    setUsername(user.username);
    setRole(user.role);
    setDialog("edit");
  };

  const update = async () => {
    if (!selected) return;
    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    setError("");
    try {
      await services.users.update({ ...selected, username, role });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      close();
      setNotice("User updated successfully.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update user.",
      );
    }
  };

  const remove = async () => {
    if (!selected) return;
    setError("");
    try {
      await services.users.remove(selected.id);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      close();
      setNotice(`${selected.username} removed successfully.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to remove user.",
      );
    }
  };

  const create = async () => {
    const name = username.trim();
    if (!name) {
      setError("Username is required.");
      return;
    }
    setError("");
    try {
      await services.users.create({
        id: `usr-${Date.now()}`,
        username: name,
        createdAt: "Just now",
        lastSignIn: null,
        role,
      });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      close();
      setNotice("User created successfully.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create user.",
      );
    }
  };

  const reset = async () => {
    if (!selected) return;
    setError("");
    try {
      await services.users.reset(selected.id);
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      close();
      setNotice(`Password reset for ${selected.username}.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to reset password.",
      );
    }
  };

  return (
    <div className="page users-page">
      <div className="page-hero">
        <span className="page-icon" style={{ background: "#d6ede0", borderRadius: "12px", width: "48px", height: "48px", display: "grid", placeItems: "center" }}>
          <img src={usersModuleIcon} alt="" style={{ width: "24px", height: "24px" }} />
        </span>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>User Management</h1>
          <p style={{ color: "#525c57", marginTop: "4px", fontSize: "15px" }}>
            Manage user accounts, sign-in metadata, and account-specific audit history.
          </p>
        </div>
      </div>

      {notice && (
        <div className="notice" role="status" style={{ background: "#e6f7ec", color: "#0c7441", padding: "10px 16px", borderRadius: "12px" }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="error" role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 16px", borderRadius: "12px" }}>
          {error}
        </div>
      )}

      <Card className="search-card" style={{ display: "flex", gap: "12px", alignItems: "center", padding: "16px 20px" }}>
        <div style={{ flex: 1 }}>
          <Field
            label=""
            placeholder="Search by username..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          style={{ height: "46px", borderRadius: "999px", padding: "0 22px", background: "#005931", color: "#fff" }}
          onClick={() => {
            setUsername("");
            setRole("User");
            setDialog("add");
          }}
        >
          ＋ Add User
        </Button>
      </Card>

      <Card className="table-card" style={{ background: "#fff", borderRadius: "20px", overflow: "visible" }}>
        <div className="table-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #e5e7eb" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Accounts</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "14px" }}>
              Showing {filteredUsers.length} users
            </p>
          </div>
        </div>

        <div className="table-wrap" style={{ overflow: "visible", minHeight: "220px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#4b5563", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "14px 20px" }}>USERNAME</th>
                <th style={{ padding: "14px 20px" }}>CREATED AT</th>
                <th style={{ padding: "14px 20px" }}>LAST SIGN IN</th>
                <th style={{ padding: "14px 20px", textAlign: "right" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user, index) => {
                const isNearBottom = index >= 3 && index >= visibleUsers.length - 2;
                return (
                <tr key={user.id} style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.15s" }}>
                  <td style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "#d6ede0", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                      <div>
                        <strong style={{ display: "block", fontSize: "14px", color: "#111827" }}>{user.username}</strong>
                        <small style={{ color: "#6b7280", fontSize: "12px" }}>{user.role}</small>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "16px 20px", color: "#374151", fontSize: "14px" }}>
                    {user.createdAt}
                  </td>
                  <td style={{ padding: "16px 20px", color: "#6b7280", fontSize: "13px" }}>
                    {user.lastSignIn ?? "Never"}
                  </td>
                  <td style={{ padding: "16px 20px", textAlign: "right", position: "relative" }}>
                    <div style={{ display: "inline-flex", gap: "6px" }} ref={actionMenuId === user.id ? actionMenuRef : undefined}>
                      <button
                        className="table-action menu-trigger"
                        aria-label={`Actions for ${user.username}`}
                        aria-expanded={actionMenuId === user.id}
                        onClick={() => setActionMenuId((current) => (current === user.id ? null : user.id))}
                        style={{ background: "#f3f4f6", border: "none", borderRadius: "8px", width: "34px", height: "34px", cursor: "pointer", fontSize: "16px", color: "#4b5563" }}
                      >
                        •••
                      </button>
                      {actionMenuId === user.id && (
                        <div
                          className="row-action-menu"
                          role="menu"
                          style={{
                            position: "absolute",
                            right: "20px",
                            top: isNearBottom ? "auto" : "44px",
                            bottom: isNearBottom ? "44px" : "auto",
                            background: "#fff",
                            borderRadius: "14px",
                            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)",
                            zIndex: 40,
                            padding: "6px",
                            minWidth: "165px",
                            border: "1px solid #e5e7eb",
                            textAlign: "left",
                          }}
                        >
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              openEdit(user);
                              setActionMenuId(null);
                            }}
                          >
                            Edit user
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              setSelected(user);
                              setDialog("history");
                              setActionMenuId(null);
                            }}
                          >
                            View history
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              setSelected(user);
                              setDialog("reset");
                              setActionMenuId(null);
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", color: "#dc2626", cursor: "pointer", borderRadius: "8px" }}
                            onClick={() => {
                              setSelected(user);
                              setDialog("remove");
                              setActionMenuId(null);
                            }}
                          >
                            Remove user
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredUsers.length && <Empty>No users found.</Empty>}
        </div>
        <Pagination
          total={filteredUsers.length}
          page={page}
          pageSize={pageSize}
          onChange={setPage}
        />
      </Card>

      {/* Edit User Modal */}
      {dialog === "edit" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "560px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ background: "#005931", color: "#fff", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Edit User</h2>
                  <p style={{ margin: "2px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Update user privileges and account credentials.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {error && (
                <div role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <Field
                  label="USERNAME"
                  required
                  value={username}
                  subhelper="Campus network account username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter username"
                />
                <Field
                  label="DEVICE ID"
                  value={selected.id ? `DEV-${selected.id.toUpperCase()}` : "DEV-UNASSIGNED"}
                  readOnly
                  badge="Hardware bound"
                  subhelper="Hardware bound (Read-only)"
                />
              </div>
              <SelectField
                label="ACCOUNT ROLE"
                required
                value={role}
                subhelper="Administrator · Staff · User"
                onChange={(event) => setRole(event.target.value as UserAccount["role"])}
              >
                <option>User</option>
                <option>Staff</option>
                <option>Administrator</option>
              </SelectField>
              <div style={{ background: "#f9fafb", borderRadius: "12px", padding: "12px 16px", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#6b7280" }}>
                <span>Created: <strong>{selected.createdAt}</strong></span>
                <span>Last sign in: <strong>{selected.lastSignIn ?? "Never"}</strong></span>
              </div>
            </div>

            <div style={{ padding: "16px 28px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={close}>
                Cancel
              </Button>
              <Button style={{ borderRadius: "999px", padding: "0 22px", background: "#005931", color: "#fff" }} onClick={update}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {dialog === "add" && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "560px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ background: "#005931", color: "#fff", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Add User</h2>
                  <p style={{ margin: "2px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Create a new campus administrator or staff account.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {error && (
                <div role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <Field
                  label="USERNAME"
                  required
                  value={username}
                  subhelper="Unique username identifier"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. staff03"
                />
                <SelectField
                  label="ROLE"
                  required
                  value={role}
                  subhelper="Administrator · Staff · User"
                  onChange={(event) => setRole(event.target.value as UserAccount["role"])}
                >
                  <option>User</option>
                  <option>Staff</option>
                  <option>Administrator</option>
                </SelectField>
              </div>
            </div>

            <div style={{ padding: "16px 28px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={close}>
                Cancel
              </Button>
              <Button style={{ borderRadius: "999px", padding: "0 22px", background: "#005931", color: "#fff" }} onClick={create}>
                Create User
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {dialog === "history" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "540px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Audit History</h2>
            <p style={{ color: "#0c7441", fontWeight: 600, margin: "4px 0 2px" }}>{selected.username}</p>
            <p style={{ color: "#6b7280", fontSize: "13px", margin: "0 0 20px" }}>Account mutation timeline</p>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "360px", overflowY: "auto" }}>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Aug 16, 2026 · 4:35 PM</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Updated Username</strong>
                  <span style={{ fontSize: "13px", color: "#4b5563" }}>administrator01 → {selected.username}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Aug 14, 2026 · 11:20 AM</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Password Reset</strong>
                  <span style={{ fontSize: "13px", color: "#4b5563" }}>Administrative temporary code generated</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{selected.createdAt}</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Created User Account</strong>
                  <span style={{ fontSize: "13px", color: "#4b5563" }}>Assigned initial role: {selected.role}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "24px", textAlign: "center" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", width: "100%", border: "1px solid #0c7441", color: "#0c7441" }} onClick={close}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Remove User Modal */}
      {dialog === "remove" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "460px", maxWidth: "90%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Remove user?</h2>
                <p style={{ margin: "4px 0 0", color: "#525c57", fontSize: "14px" }}>
                  This will remove {selected.username} from the system.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={close}>
                Cancel
              </Button>
              <Button style={{ background: "#dc2626", color: "#fff", borderRadius: "999px", padding: "0 22px" }} onClick={remove}>
                Remove User
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {dialog === "reset" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "460px", maxWidth: "90%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#d6ede0", color: "#0c7441", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Reset Password?</h2>
                <p style={{ margin: "4px 0 0", color: "#525c57", fontSize: "14px" }}>
                  Generate a temporary authentication code for {selected.username}?
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={close}>
                Cancel
              </Button>
              <Button style={{ background: "#0c7441", color: "#fff", borderRadius: "999px", padding: "0 22px" }} onClick={reset}>
                Reset Password
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
