import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { PasswordConfirmationRequiredError, SuperadminRequiredError } from "../../services/errors";
import type { AdminAccount, AdminRole } from "../../types";
import { Shell } from "../../components/Shell";
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
    refreshSession: vi.fn(),
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
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "A-long-enough-secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      username: "admin_new", email: "new@isu.edu.ph", password: "A-long-enough-secret1",
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

  describe("password rules", () => {
    const checklist = () => within(screen.getByRole("list", { name: "Password requirements" }));
    const rule = (state: "Met" | "Not met", label: string) => checklist().getByRole("listitem", { name: `${state}: ${label}` });

    const fill = (password: string) => {
      fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@isu.edu.ph" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    };

    it("shows the reset page's live checklist under the password field in place of the length hint", async () => {
      await openAdministrators();
      fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));

      expect(screen.queryByText("At least 8 characters.")).not.toBeInTheDocument();
      expect(checklist().getAllByRole("listitem")).toHaveLength(5);
      for (const label of ["At least 8 characters", "An uppercase letter", "A lowercase letter", "A number", "A symbol"]) {
        rule("Not met", label);
      }

      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Abc1" } });
      rule("Not met", "At least 8 characters");
      rule("Met", "An uppercase letter");
      rule("Met", "A lowercase letter");
      rule("Met", "A number");
      rule("Not met", "A symbol");

      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Abcdef1!" } });
      for (const label of ["At least 8 characters", "An uppercase letter", "A lowercase letter", "A number", "A symbol"]) {
        rule("Met", label);
      }
    });

    it.each([
      ["Abcde1!", "Password must be at least 8 characters."],
      ["abcdefg1!", "Password must include an uppercase letter."],
      ["ABCDEFG1!", "Password must include a lowercase letter."],
      ["Abcdefgh!", "Password must include a number."],
      ["Abcdefg12", "Password must include a symbol."],
    ])("refuses %s with the first unmet rule and does not save", async (password, message) => {
      const save = vi.spyOn(services.admins, "save");
      await openAdministrators();
      fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
      fill(password);
      fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });

    it("reports only the first unmet rule when several fail", async () => {
      await openAdministrators();
      fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
      fill("abc");
      fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

      expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
      expect(screen.queryByText("Password must include an uppercase letter.")).not.toBeInTheDocument();
    });

    it("saves a password that meets every rule", async () => {
      const save = vi.spyOn(services.admins, "save");
      await openAdministrators();
      fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
      fill("Abcdef1!");
      fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

      await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ password: "Abcdef1!" })));
    });
  });

  it("offers no way to edit an account from the directory", async () => {
    await openAdministrators();

    // Sign-in details are changed through account customization, so the row
    // actions stop short of them — on your own row as much as anyone else's.
    const roleAction: Record<string, string> = { admin_registrar: "Make superadmin", admin_justine: "Make administrator" };
    for (const username of ["admin_registrar", "admin_justine"]) {
      openRowMenu(username);
      const actions = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(actions.map((action) => action.textContent)).toEqual([
        "View activity", "Deactivate account", roleAction[username], "Send password reset code", "Remove administrator",
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
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "A-long-enough-secret1" } });
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

describe("Changing an administrator's role", () => {
  const dean: AdminAccount = { id: "3", username: "admin_dean", email: "dean@isu.edu.ph", status: "Active", role: "superadmin", isCurrent: false };

  beforeEach(() => {
    signInAs("superadmin");
    vi.spyOn(services.admins, "list").mockResolvedValue([...directory.map((admin) => ({ ...admin })), { ...dean }]);
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const confirmWith = (password: string, button: string) => {
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: button }));
  };

  it("offers the change the row's current role allows, and never the one it already has", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    expect(screen.getByRole("menuitem", { name: "Make superadmin" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Make administrator" })).not.toBeInTheDocument();
    openRowMenu("admin_registrar");

    openRowMenu("admin_dean");
    expect(screen.getByRole("menuitem", { name: "Make administrator" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Make superadmin" })).not.toBeInTheDocument();
  });

  it("promotes an administrator only after the password is confirmed", async () => {
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    const setRole = vi.spyOn(services.admins, "setRole").mockResolvedValue({ ...directory[1], role: "superadmin" });
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));

    // The dialog names the account and what the role allows; nothing is sent until confirmed.
    const dialog = screen.getByRole("dialog", { name: "Make superadmin?" });
    expect(within(dialog).getByText("admin_registrar")).toBeInTheDocument();
    expect(within(dialog).getByText(/add, deactivate and remove administrators/)).toBeInTheDocument();
    expect(setRole).not.toHaveBeenCalled();

    confirmWith("password123", "Make Superadmin");

    await waitFor(() => expect(setRole).toHaveBeenCalledWith("2", "superadmin"));
    expect(confirmPassword).toHaveBeenCalledWith("password123");
    expect(await screen.findByText("admin_registrar was promoted to superadmin successfully.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Make superadmin?" })).not.toBeInTheDocument();
  });

  it("demotes a superadmin and says what they keep and lose", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    const setRole = vi.spyOn(services.admins, "setRole").mockResolvedValue({ ...dean, role: "admin" });
    await openAdministrators();

    openRowMenu("admin_dean");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make administrator" }));

    const dialog = screen.getByRole("dialog", { name: "Make administrator?" });
    expect(within(dialog).getByText("admin_dean")).toBeInTheDocument();
    expect(within(dialog).getByText(/keeps their account/)).toBeInTheDocument();
    confirmWith("password123", "Make Administrator");

    await waitFor(() => expect(setRole).toHaveBeenCalledWith("3", "admin"));
    expect(await screen.findByText("admin_dean was demoted to administrator successfully.")).toBeInTheDocument();
  });

  it("refreshes the list after a change", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "setRole").mockResolvedValue({ ...directory[1], role: "superadmin" });
    const list = vi.mocked(services.admins.list);
    await openAdministrators();
    const before = list.mock.calls.length;

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    confirmWith("password123", "Make Superadmin");

    await screen.findByText("admin_registrar was promoted to superadmin successfully.");
    expect(list.mock.calls.length).toBeGreaterThan(before);
  });

  it("reports a rejected password in the dialog and keeps it open for a retry", async () => {
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword")
      .mockRejectedValueOnce(new Error("Password is incorrect"))
      .mockResolvedValueOnce(undefined);
    const setRole = vi.spyOn(services.admins, "setRole").mockResolvedValue({ ...directory[1], role: "superadmin" });
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    confirmWith("wrong", "Make Superadmin");

    expect(await screen.findByText("Password is incorrect")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Make superadmin?" })).toBeInTheDocument();
    expect(setRole).not.toHaveBeenCalled();

    confirmWith("password123", "Make Superadmin");
    await waitFor(() => expect(setRole).toHaveBeenCalledWith("2", "superadmin"));
    expect(confirmPassword).toHaveBeenCalledTimes(2);
  });

  it("asks for the password before sending anything, in the role change's own words", async () => {
    const setRole = vi.spyOn(services.admins, "setRole");
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Make Superadmin" }));

    expect(await screen.findByText("Enter your password to confirm this role change.")).toBeInTheDocument();
    expect(screen.getByText("Changing a role needs your password.")).toBeInTheDocument();
    expect(screen.queryByText(/deletion/)).not.toBeInTheDocument();
    expect(setRole).not.toHaveBeenCalled();
  });

  it("re-prompts when the backend reports the confirmation expired", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "setRole").mockRejectedValue(new PasswordConfirmationRequiredError());
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    confirmWith("password123", "Make Superadmin");

    expect(await screen.findByText("Your password confirmation expired. Enter it again to change this role.")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm your password")).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Make superadmin?" })).toBeInTheDocument();
  });

  it("shows any other refusal in the dialog and leaves it open", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "setRole")
      .mockRejectedValue(new Error("At least one active superadmin is required. Promote another account first."));
    await openAdministrators();

    openRowMenu("admin_dean");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make administrator" }));
    confirmWith("password123", "Make Administrator");

    expect(await screen.findByText("At least one active superadmin is required. Promote another account first."))
      .toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Make administrator?" })).toBeInTheDocument();
  });

  it("discards a half-typed password when the dialog is cancelled", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "half" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    expect(screen.getByLabelText("Confirm your password")).toHaveValue("");
  });

  it("disables the role action on the signed-in account's own row, saying why", async () => {
    await openAdministrators();

    openRowMenu("admin_justine");
    const item = screen.getByRole("menuitem", { name: "Make administrator" });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "You cannot change your own role.");
  });

  it("keeps the removal dialog's wording as it was", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));

    expect(await screen.findByText("Enter your password to confirm this deletion.")).toBeInTheDocument();
    expect(screen.getByText("This permanent deletion needs your password.")).toBeInTheDocument();
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

describe("Choosing a role when adding an administrator", () => {
  const added = (role: AdminRole): AdminAccount => ({
    id: "9", username: "admin_new", email: "new@isu.edu.ph", status: "Active", role, isCurrent: false,
  });

  beforeEach(() => {
    signInAs("superadmin");
    vi.spyOn(services.admins, "list").mockResolvedValue(directory.map((admin) => ({ ...admin })));
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function openAddForm() {
    await openAdministrators();
    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    return screen.getByRole("dialog", { name: "Add Administrator" });
  }

  const fillDetails = () => {
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "A-long-enough-secret1" } });
  };

  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

  it("offers Administrator and Superadmin, defaulting to Administrator without a password prompt", async () => {
    const dialog = await openAddForm();

    const role = within(dialog).getByLabelText("Role") as HTMLSelectElement;
    expect(role.value).toBe("admin");
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent)).toEqual(["Administrator", "Superadmin"]);
    expect(within(dialog).queryByLabelText("Confirm your password")).not.toBeInTheDocument();
  });

  it("adds a plain administrator without confirming a password", async () => {
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword");
    const save = vi.spyOn(services.admins, "save").mockResolvedValue(added("admin"));
    await openAddForm();

    fillDetails();
    submit();

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ username: "admin_new", role: "admin" })));
    expect(confirmPassword).not.toHaveBeenCalled();
    expect(await screen.findByText("admin_new was added successfully.")).toBeInTheDocument();
  });

  it("asks for the password when Superadmin is chosen and sends the role once it is confirmed", async () => {
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    const save = vi.spyOn(services.admins, "save").mockResolvedValue(added("superadmin"));
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    expect(within(dialog).getByLabelText("Confirm your password")).toBeInTheDocument();
    expect(within(dialog).getByText("Creating a superadmin needs your password.")).toBeInTheDocument();

    fillDetails();
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "password123" } });
    submit();

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ username: "admin_new", role: "superadmin" })));
    expect(confirmPassword).toHaveBeenCalledWith("password123");
    expect(await screen.findByText("admin_new was added successfully.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add Administrator" })).not.toBeInTheDocument();
  });

  it("does not create the account until a password is entered", async () => {
    const save = vi.spyOn(services.admins, "save");
    const confirmPassword = vi.spyOn(services.auth, "confirmPassword");
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fillDetails();
    submit();

    expect(await screen.findByText("Enter your password to confirm creating a superadmin.")).toBeInTheDocument();
    expect(confirmPassword).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a rejected password in the form, which stays open with the details intact", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockRejectedValue(new Error("Password is incorrect"));
    const save = vi.spyOn(services.admins, "save");
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fillDetails();
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "wrong" } });
    submit();

    expect(await within(dialog).findByText("Password is incorrect")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Add Administrator" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Username")).toHaveValue("admin_new");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("new@isu.edu.ph");
    expect(within(dialog).getByLabelText("Password")).toHaveValue("A-long-enough-secret1");
    expect(within(dialog).getByLabelText("Role")).toHaveValue("superadmin");
  });

  it("keeps the details and shows a taken username when the server refuses after the password was accepted", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "save").mockRejectedValue(
      Object.assign(new Error("That username is already taken"), { fieldErrors: { username: "That username is already taken" } }),
    );
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fillDetails();
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "password123" } });
    submit();

    expect((await within(dialog).findAllByText("That username is already taken")).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText("Email")).toHaveValue("new@isu.edu.ph");
    expect(within(dialog).getByLabelText("Role")).toHaveValue("superadmin");
  });

  it("asks again when the server says the confirmation has expired", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "save").mockRejectedValue(new PasswordConfirmationRequiredError("Confirm your password to create a superadmin."));
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fillDetails();
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "password123" } });
    submit();

    expect(await within(dialog).findByText("Your password confirmation expired. Enter it again to create this account.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Confirm your password")).toHaveValue("");
    expect(within(dialog).getByLabelText("Username")).toHaveValue("admin_new");
  });

  it("shows a role error from the server against the role choice", async () => {
    vi.spyOn(services.admins, "save").mockRejectedValue(
      Object.assign(new Error("Role must be Administrator or Superadmin."), { fieldErrors: { role: "Role must be Administrator or Superadmin." } }),
    );
    const dialog = await openAddForm();

    fillDetails();
    submit();

    const role = within(dialog).getByLabelText("Role");
    await waitFor(() => expect(role).toHaveAccessibleDescription(/Role must be Administrator or Superadmin\./));
    expect(role).toBeInvalid();
  });

  it("drops the confirmation when the choice goes back to Administrator", async () => {
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "admin" } });
    expect(within(dialog).queryByLabelText("Confirm your password")).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    expect(within(dialog).getByLabelText("Confirm your password")).toHaveValue("");
  });

  it("resets the role to Administrator when the form is reopened after cancelling or saving", async () => {
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
    vi.spyOn(services.admins, "save").mockResolvedValue(added("superadmin"));
    const dialog = await openAddForm();

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "superadmin" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    expect(screen.getByLabelText("Role")).toHaveValue("admin");
    expect(screen.queryByLabelText("Confirm your password")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    expect(screen.getByLabelText("Confirm your password")).toHaveValue("");
    fillDetails();
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    submit();
    await screen.findByText("admin_new was added successfully.");

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    expect(screen.getByLabelText("Role")).toHaveValue("admin");
    expect(screen.queryByLabelText("Confirm your password")).not.toBeInTheDocument();
  });

  it("does not offer the form to a plain administrator", async () => {
    signInAs("admin", "admin_registrar");
    vi.spyOn(services.admins, "list").mockResolvedValue(directoryForRegistrar());
    await openAdministrators();
    expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument();
  });
});

describe("A superadmin session that has gone stale", () => {
  const dean: AdminAccount = { id: "3", username: "admin_dean", email: "dean@isu.edu.ph", status: "Active", role: "superadmin", isCurrent: false };
  const inactive: AdminAccount = { id: "4", username: "admin_idle", email: "idle@isu.edu.ph", status: "Inactive", role: "admin", isCurrent: false };
  const refusal = () => new SuperadminRequiredError("Superadmin access required");
  const demotedSession = { id: "1", username: "admin_justine", role: "admin" as const };
  let me: ReturnType<typeof vi.spyOn>;
  let list: ReturnType<typeof vi.spyOn>;

  /** The list the server returns once the viewer has been demoted: same accounts, new role. */
  const demotedDirectory = () => [
    { ...directory[0], role: "admin" as const },
    { ...directory[1] },
    { ...dean },
    { ...inactive },
  ];

  beforeEach(() => {
    // The real provider: the page must end up with whatever `me()` reports after the refusal.
    me = vi.spyOn(services.auth, "me").mockResolvedValueOnce({ id: "1", username: "admin_justine", role: "superadmin" });
    list = vi.spyOn(services.admins, "list").mockResolvedValueOnce([{ ...directory[0] }, { ...directory[1] }, { ...dean }, { ...inactive }]);
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    vi.spyOn(services.auth, "confirmPassword").mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** After the refusal the server reports a plain administrator. */
  const demoteOnServer = () => {
    me.mockResolvedValue(demotedSession);
    list.mockResolvedValue(demotedDirectory());
  };

  function renderSignedIn(withShell = false) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const page = <Users />;
    return render(
      <QueryClientProvider client={client}>
        <AuthContext.AuthProvider>
          <MemoryRouter initialEntries={["/users"]}>
            {withShell ? <Shell>{page}</Shell> : page}
          </MemoryRouter>
        </AuthContext.AuthProvider>
      </QueryClientProvider>,
    );
  }

  async function openSignedInAdministrators(withShell = false) {
    renderSignedIn(withShell);
    // The Add button appears once the session has loaded.
    fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
    await screen.findByText("admin_registrar");
    await screen.findByRole("button", { name: /add administrator/i });
  }

  /** Everything a plain administrator no longer sees. */
  async function expectPlainAdministratorView() {
    await waitFor(() => expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument());
    openRowMenu("admin_registrar");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View activity", "Send password reset code"]);
  }

  const expectRefusalAnnounced = async () => {
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Superadmin access required");
  };

  it("announces the refusal, closes the dialog and shows the plain view after a refused role change", async () => {
    vi.spyOn(services.admins, "setRole").mockRejectedValue(refusal());
    await openSignedInAdministrators();
    expect(me).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);

    demoteOnServer();
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Make Superadmin" }));

    await expectRefusalAnnounced();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await expectPlainAdministratorView();
    // The message stays up after the dialog and the controls are gone.
    expect(screen.getByRole("alert")).toHaveTextContent("Superadmin access required");
  });

  it("recovers from a refused removal", async () => {
    vi.spyOn(services.admins, "remove").mockRejectedValue(refusal());
    await openSignedInAdministrators();

    demoteOnServer();
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));

    await expectRefusalAnnounced();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectPlainAdministratorView();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("recovers from a refused deactivation", async () => {
    vi.spyOn(services.admins, "setStatus").mockRejectedValue(refusal());
    await openSignedInAdministrators();

    demoteOnServer();
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Deactivate account" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate Account" }));

    await expectRefusalAnnounced();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectPlainAdministratorView();
  });

  it("recovers from a refused reactivation, which has no dialog to close", async () => {
    vi.spyOn(services.admins, "setStatus").mockRejectedValue(refusal());
    await openSignedInAdministrators();

    demoteOnServer();
    openRowMenu("admin_idle");
    fireEvent.click(screen.getByRole("menuitem", { name: "Activate account" }));

    await expectRefusalAnnounced();
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument();
  });

  it("recovers from a refused add and drops the form with its typed values", async () => {
    vi.spyOn(services.admins, "save").mockRejectedValue(refusal());
    await openSignedInAdministrators();

    demoteOnServer();
    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "A-long-enough-secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));

    await expectRefusalAnnounced();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectPlainAdministratorView();
  });

  it("makes the Shell's role label follow the refreshed session", async () => {
    vi.spyOn(services.admins, "setRole").mockRejectedValue(refusal());
    await openSignedInAdministrators(true);
    expect(screen.getByText("SUPERADMIN")).toBeInTheDocument();

    demoteOnServer();
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Make Superadmin" }));

    expect(await screen.findByText("ADMINISTRATOR")).toBeInTheDocument();
    expect(screen.queryByText("SUPERADMIN")).not.toBeInTheDocument();
  });

  it("does not re-read the session for other failures", async () => {
    const save = vi.spyOn(services.admins, "save");
    const remove = vi.spyOn(services.admins, "remove");
    await openSignedInAdministrators();

    // Validation: stays in the form, against its field.
    save.mockRejectedValue(Object.assign(new Error("Username already exists."), { fieldErrors: { username: "Username already exists." } }));
    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_new" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "A-long-enough-secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));
    await waitFor(() => expect(screen.getAllByText("Username already exists.").length).toBeGreaterThan(0));
    expect(screen.getByRole("dialog", { name: "Add Administrator" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    // Password confirmation expired: re-prompts in the dialog.
    remove.mockRejectedValueOnce(new PasswordConfirmationRequiredError());
    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));
    expect(await screen.findByText(/confirmation expired/i)).toBeInTheDocument();

    // Anything else, such as a network failure: shown in the dialog.
    remove.mockRejectedValueOnce(new Error("Network down"));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));
    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    expect(me).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /add administrator/i })).toBeInTheDocument();
  });
});
