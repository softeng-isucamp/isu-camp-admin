import { useEffect, useState } from "react";
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
  const close = () => setDialog(null);
  const visibleUsers = (data?.items ?? []).slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  useEffect(() => setPage(1), [query]);
  const openEdit = (user: UserAccount) => {
    setSelected(user);
    setUsername(user.username);
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
      await services.users.update({ ...selected, username });
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
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">
          <img src={usersModuleIcon} alt="" />
        </span>
        <div>
          <h1>User Management</h1>
          <p>
            Manage user accounts, sign-in metadata, and account-specific audit
            history.
          </p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Card className="search-card">
        <Field
          label=""
          placeholder="Search by username..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          onClick={() => {
            setUsername("");
            setRole("User");
            setDialog("add");
          }}
        >
          ＋ Add User
        </Button>
      </Card>
      <Card className="table-card">
        <div className="table-heading">
          <div>
            <h2>Accounts</h2>
            <p>Showing {data?.items.length ?? 0} users</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>USERNAME</th>
                <th>CREATED AT</th>
                <th>LAST SIGN IN</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.username}</strong>
                  </td>
                  <td>{user.createdAt}</td>
                  <td>{user.lastSignIn ?? "Never"}</td>
                  <td>
                    <button
                      className="text-action"
                      onClick={() => openEdit(user)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-action"
                      onClick={() => {
                        setSelected(user);
                        setDialog("history");
                      }}
                    >
                      View History
                    </button>
                    <button
                      className="text-action"
                      onClick={() => {
                        setSelected(user);
                        setDialog("reset");
                      }}
                    >
                      Reset Password
                    </button>
                    <button
                      className="text-action danger-text"
                      onClick={() => {
                        setSelected(user);
                        setDialog("remove");
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.items.length && <Empty>No users found.</Empty>}
        </div>
        <Pagination
          total={data?.items.length ?? 0}
          page={page}
          pageSize={pageSize}
          onChange={setPage}
        />
      </Card>
      {dialog === "edit" && selected && (
        <Modal
          title="Edit User"
          subtitle="Update user privileges and account credentials."
          size="md"
          variant="green"
          onClose={close}
        >
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
              {error}
            </div>
          )}
          <div className="form-grid-two">
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
            onChange={(event) =>
              setRole(event.target.value as UserAccount["role"])
            }
          >
            <option>User</option>
            <option>Staff</option>
            <option>Administrator</option>
          </SelectField>
          <div className="record-information">
            <strong>ACCOUNT TIMESTAMPS</strong>
            <span>Created {selected.createdAt}</span>
            <span>Last sign in {selected.lastSignIn ?? "Never"}</span>
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button onClick={update}>Save Changes</Button>
          </div>
        </Modal>
      )}
      {dialog === "add" && (
        <Modal
          title="Add User"
          subtitle="Create a new campus administrator or staff account."
          size="md"
          variant="green"
          onClose={close}
        >
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
              {error}
            </div>
          )}
          <div className="form-grid-two">
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
              onChange={(event) =>
                setRole(event.target.value as UserAccount["role"])
              }
            >
              <option>User</option>
              <option>Staff</option>
              <option>Administrator</option>
            </SelectField>
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button onClick={create}>Create User</Button>
          </div>
        </Modal>
      )}
      {dialog === "history" && selected && (
        <Modal
          title="Audit History"
          subtitle={`Account mutation timeline for ${selected.username}`}
          size="md"
          variant="green"
          onClose={close}
        >
          <div className="history-list">
            <div>
              <small>Aug 16, 2026 · 4:35 PM</small>
              <strong>Updated Username</strong>
              <span>administrator01 → {selected.username}</span>
            </div>
            <div>
              <small>Aug 14, 2026 · 11:20 AM</small>
              <strong>Password Reset</strong>
              <span>Administrative temporary code generated</span>
            </div>
            <div>
              <small>{selected.createdAt}</small>
              <strong>Created User Account</strong>
              <span>Assigned initial role: {selected.role}</span>
            </div>
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>Close</Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && selected && (
        <Modal
          title="Remove User?"
          subtitle="This user will immediately lose access to the system."
          size="sm"
          variant="danger"
          onClose={close}
        >
          <p className="text-xs text-[#3f4941] leading-relaxed">
            Are you sure you want to remove <strong>{selected.username}</strong>?
          </p>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Remove User
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "reset" && selected && (
        <Modal
          title="Reset Password?"
          subtitle="Generate a temporary authentication code."
          size="sm"
          variant="green"
          onClose={close}
        >
          <p className="text-xs text-[#3f4941] leading-relaxed">
            Generate a secure temporary password reset action for <strong className="text-[#191c1d]">{selected.username}</strong>?
          </p>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button onClick={reset}>Reset Password</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
