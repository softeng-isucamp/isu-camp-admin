import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { PasswordConfirmationRequiredError } from "../../services/errors";
import type { AdminAccount, AdminRole } from "../../types";
import * as AuthContext from "../auth/AuthContext";
import { Users } from "./Users";

const directory: AdminAccount[] = [
  { id: "1", username: "admin_justine", email: "justine@isu.edu.ph", status: "Active", role: "superadmin", isCurrent: true },
  { id: "2", username: "admin_registrar", email: "registrar@isu.edu.ph", status: "Active", role: "admin", isCurrent: false },
];

/** The panel reads the viewer's role from the session; the list marks which row is theirs. */
function signInAs(role: AdminRole | undefined, username = "admin_justine") {
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    session: { id: "1", username, ...(role ? { role } : {}) },
    login: vi.fn(),
    logout: vi.fn(),
    loading: false,
    updateSession: vi.fn(),
  });
}

/** The directory as seen by the plain administrator `admin_registrar`. */
const directoryForRegistrar = () => directory.map((admin) => ({ ...admin, isCurrent: admin.id === "2" }));

/** Stands in for the System Logs page so a row's link can be read off the URL. */
function LogsProbe() {
  const location = useLocation();
  return <div data-testid="logs-route">{location.search}</div>;
}

function renderUsers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/users"]}>
        <Routes>
          <Route path="/users" element={<Users />} />
          <Route path="/system-logs" element={<LogsProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the Administrators tab and waits for its rows. */
async function openAdministrators() {
  renderUsers();
  fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
  await screen.findByText("admin_registrar");
}

function openRowMenu(username: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${username}` }));
}

describe("Administrator accounts in User Management", () => {
  beforeEach(() => {
    signInAs("superadmin");
    vi.spyOn(services.admins, "list").mockResolvedValue(directory.map((admin) => ({ ...admin })));
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists administrators beside the app users and marks the signed-in account", async () => {
    await openAdministrators();

    expect(screen.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    const row = screen.getByText("admin_justine").closest("tr")!;
    expect(within(row).getByText("Superadmin · You")).toBeInTheDocument();
    expect(within(screen.getByText("admin_registrar").closest("tr")!).getByText("Administrator")).toBeInTheDocument();
  });

  it("labels each account with its own role, whoever is signed in", async () => {
    vi.spyOn(services.admins, "list").mockResolvedValue([
      { ...directory[0], isCurrent: false },
      { ...directory[1], isCurrent: true },
      { id: "3", username: "admin_dean", email: "dean@isu.edu.ph", status: "Active", role: "superadmin", isCurrent: false },
    ]);
    signInAs("admin", "admin_registrar");
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_dean");

    const labelOf = (username: string) => within(screen.getByText(username).closest("tr")!).getByText(/Superadmin|Administrator/).textContent;
    expect(labelOf("admin_justine")).toBe("Superadmin");
    expect(labelOf("admin_registrar")).toBe("Administrator · You");
    expect(labelOf("admin_dean")).toBe("Superadmin");
  });

  it("keeps the app user directory on its own tab", async () => {
    renderUsers();
    // App Users is the default tab.
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administrators" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Administrators" }));
    expect(await screen.findByRole("heading", { name: "Administrators" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("adds an administrator and reports the outcome", async () => {
    const save = vi.spyOn(services.admins, "save").mockResolvedValue({
      id: "3", username: "admin_new", email: "new@isu.edu.ph", status: "Active", role: "admin", isCurrent: false,
    });
    await openAdministrators();

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-enough-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret",
    })));
    expect(await screen.findByText("admin_new was added successfully.")).toBeInTheDocument();
  });

  it("validates the new account before calling the service", async () => {
    const save = vi.spyOn(services.admins, "save");
    await openAdministrators();

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));
    expect(await screen.findByText("Username is required.")).toBeInTheDocument();
    expect(screen.getByText("Email is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("offers no way to edit an account from the directory", async () => {
    await openAdministrators();

    // Sign-in details are changed through account customization, so the row
    // actions stop short of them — on your own row as much as anyone else's.
    for (const username of ["admin_registrar", "admin_justine"]) {
      openRowMenu(username);
      const actions = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(actions.map((action) => action.textContent)).toEqual([
        "View activity", "Deactivate account", "Send password reset code", "Remove administrator",
      ]);
      openRowMenu(username);
    }
  });

  it("links a row to that administrator's recorded activity", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "View activity" }));

    const search = new URLSearchParams((await screen.findByTestId("logs-route")).textContent ?? "");
    expect(search.get("q")).toBe("admin_registrar");
    expect(search.get("category")).toBe("Admin");
  });

  it("shows each account's status and deactivates one after confirming", async () => {
    const setStatus = vi.spyOn(services.admins, "setStatus").mockResolvedValue({
      ...directory[1], status: "Inactive",
    });
    await openAdministrators();

    const row = screen.getByText("admin_registrar").closest("tr")!;
    expect(within(row).getByText("Active")).toBeInTheDocument();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Deactivate account" }));

    // Revoking access asks first, and says the account itself is kept.
    const dialog = screen.getByRole("dialog", { name: "Deactivate this administrator?" });
    expect(within(dialog).getByText(/activate the account again/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate Account" }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("2", "Inactive"));
    expect(await screen.findByText("admin_registrar was deactivated successfully.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Deactivate this administrator?" })).not.toBeInTheDocument();
  });

  it("reactivates a deactivated account without a confirmation step", async () => {
    vi.spyOn(services.admins, "list").mockResolvedValue([
      { ...directory[0] },
      { ...directory[1], status: "Inactive" },
    ]);
    const setStatus = vi.spyOn(services.admins, "setStatus").mockResolvedValue({
      ...directory[1], status: "Active",
    });
    await openAdministrators();

    expect(within(screen.getByText("admin_registrar").closest("tr")!).getByText("Inactive")).toBeInTheDocument();
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Activate account" }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("2", "Active"));
    expect(await screen.findByText("admin_registrar was activated successfully.")).toBeInTheDocument();
  });

  it("keeps the deactivation dialog open and explains a refusal", async () => {
    vi.spyOn(services.admins, "setStatus")
      .mockRejectedValue(new Error("The last active administrator cannot be deactivated."));
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Deactivate account" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Account" }));

    expect(await screen.findByText("The last active administrator cannot be deactivated.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Deactivate this administrator?" })).toBeInTheDocument();
  });

  it("will not offer to deactivate the signed-in administrator", async () => {
    await openAdministrators();

    openRowMenu("admin_justine");

    expect(screen.getByRole("menuitem", { name: "Deactivate account" })).toBeDisabled();
  });

  it("mails a reset code to another administrator after confirming", async () => {
    const sendPasswordReset = vi.spyOn(services.admins, "sendPasswordReset")
      .mockResolvedValue("A password reset code was sent to registrar@isu.edu.ph.");
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Send password reset code" }));

    // The dialog says where the code goes, and never shows the code itself.
    const dialog = screen.getByRole("dialog", { name: "Send a password reset code?" });
    expect(within(dialog).getByText("registrar@isu.edu.ph")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Reset Code" }));

    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith("2"));
    expect(await screen.findByText("A password reset code was sent to registrar@isu.edu.ph.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Send a password reset code?" })).not.toBeInTheDocument();
  });

  it("keeps the reset dialog open and explains a send failure", async () => {
    vi.spyOn(services.admins, "sendPasswordReset").mockRejectedValue(new Error("Failed to send the password reset code."));
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Send password reset code" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));

    expect(await screen.findByText("Failed to send the password reset code.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Send a password reset code?" })).toBeInTheDocument();
  });

  it("will not offer a reset code for an account with no address on file", async () => {
    vi.spyOn(services.admins, "list").mockResolvedValue([
      { ...directory[0] },
      { id: "2", username: "admin_registrar", email: "", status: "Active", role: "admin", isCurrent: false },
    ]);
    await openAdministrators();

    openRowMenu("admin_registrar");
    expect(screen.getByRole("menuitem", { name: "Send password reset code" })).toBeDisabled();
    // Access is still revocable; only the email action depends on an address.
    expect(screen.getByRole("menuitem", { name: "Deactivate account" })).toBeEnabled();
  });

  it("surfaces a duplicate username reported by the service", async () => {
    const duplicate = new Error("That username is already taken") as Error & { fieldErrors?: Record<string, string> };
    duplicate.fieldErrors = { username: "That username is already taken" };
    vi.spyOn(services.admins, "save").mockRejectedValue(duplicate);
    await openAdministrators();

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_registrar" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "dupe@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-enough-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

    expect(await screen.findAllByText("That username is already taken")).not.toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Add Administrator" })).toBeInTheDocument();
  });

  it("will not offer to remove the signed-in administrator", async () => {
    await openAdministrators();

    openRowMenu("admin_justine");

    expect(screen.getByRole("menuitem", { name: "Remove administrator" })).toBeDisabled();
  });

  it("removes another administrator only after the password is confirmed", async () => {
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword")
      .mockRejectedValueOnce(new Error("Password is incorrect"))
      .mockResolvedValueOnce(undefined);
    const remove = vi.spyOn(services.admins, "remove").mockResolvedValue(undefined);
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));

    // The wrong password stops it before the service is reached.
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));
    expect(await screen.findByText("Password is incorrect")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("2"));
    expect(confirmPassword).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("admin_registrar was removed successfully.")).toBeInTheDocument();
  });

  it("re-prompts when the backend reports the confirmation expired", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "remove").mockRejectedValue(new PasswordConfirmationRequiredError());
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));

    expect(await screen.findByText(/Your password confirmation expired/)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm your password")).toHaveValue("");
  });
});

describe("Administrators tab for a plain administrator", () => {
  beforeEach(() => {
    signInAs("admin", "admin_registrar");
    vi.spyOn(services.admins, "list").mockResolvedValue(directoryForRegistrar());
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("still lists every account and its role", async () => {
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_justine");

    expect(within(screen.getByText("admin_justine").closest("tr")!).getByText("Superadmin")).toBeInTheDocument();
    expect(within(screen.getByText("admin_registrar").closest("tr")!).getByText("Administrator · You")).toBeInTheDocument();
  });

  it("does not offer to add an administrator", async () => {
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_justine");

    expect(screen.getByRole("heading", { name: "Administrators" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument();
  });

  it("offers only View activity and Send password reset code on every row, their own included", async () => {
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_justine");

    for (const username of ["admin_justine", "admin_registrar"]) {
      openRowMenu(username);
      const actions = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(actions.map((action) => action.textContent)).toEqual(["View activity", "Send password reset code"]);
      openRowMenu(username);
    }
  });

  it("sends a reset code to a superadmin", async () => {
    const sendPasswordReset = vi.spyOn(services.admins, "sendPasswordReset")
      .mockResolvedValue("A password reset code was sent to justine@isu.edu.ph.");
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_justine");

    openRowMenu("admin_justine");
    fireEvent.click(screen.getByRole("menuitem", { name: "Send password reset code" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));

    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("A password reset code was sent to justine@isu.edu.ph.")).toBeInTheDocument();
  });

  it("treats a session with no role as a plain administrator", async () => {
    signInAs(undefined, "admin_registrar");
    renderUsers();
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_justine");

    expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument();
    openRowMenu("admin_justine");
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem")).toHaveLength(2);
  });
});
