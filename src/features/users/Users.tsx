import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
        <Modal title="Edit User" onClose={close}>
          <Field
            label="USERNAME"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <Field label="PASSWORD" value="•••••••••••••" readOnly />
          <p className="muted">Protected · Read-only</p>
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
        <Modal title="Add User" onClose={close}>
          <Field
            label="USERNAME"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. staff03"
          />
          <SelectField
            label="ROLE"
            value={role}
            onChange={(event) =>
              setRole(event.target.value as UserAccount["role"])
            }
          >
            <option>User</option>
            <option>Staff</option>
            <option>Administrator</option>
          </SelectField>
          <div className="modal-actions">
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button onClick={create}>Create User</Button>
          </div>
        </Modal>
      )}
      {dialog === "history" && selected && (
        <Modal title="Audit History" onClose={close}>
          <p className="muted">
            Account changes only. Password values are never shown.
          </p>
          <div className="history-list">
            <div>
              <small>Aug 16, 2026 · 4:35 PM</small>
              <strong>Updated Username</strong>
              <span>administrator01 → {selected.username}</span>
            </div>
            <div>
              <small>Aug 14, 2026 · 11:20 AM</small>
              <strong>Password Reset</strong>
            </div>
            <div>
              <small>{selected.createdAt}</small>
              <strong>Created User</strong>
            </div>
          </div>
          <div className="modal-actions">
            <Button onClick={close}>Close</Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && selected && (
        <Modal title="Remove User?" onClose={close}>
          <p>
            This action will remove <strong>{selected.username}</strong>.
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
        <Modal title="Reset Password?" onClose={close}>
          <p>
            Generate a reset action for <strong>{selected.username}</strong>?
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
