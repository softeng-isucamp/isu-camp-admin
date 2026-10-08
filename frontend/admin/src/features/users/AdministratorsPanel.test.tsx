import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { PasswordConfirmationRequiredError } from "../../services/errors";
import type { AdminAccount } from "../../types";
import { Users } from "./Users";

const directory: AdminAccount[] = [
  { id: "1", username: "admin_justine", email: "justine@isu.edu.ph", isCurrent: true },
  { id: "2", username: "admin_registrar", email: "registrar@isu.edu.ph", isCurrent: false },
];

function renderUsers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/users"]}><Users /></MemoryRouter>
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
    expect(within(row).getByText("Administrator · You")).toBeInTheDocument();
    expect(within(screen.getByText("admin_registrar").closest("tr")!).getByText("Administrator")).toBeInTheDocument();
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
      id: "3", username: "admin_new", email: "new@isu.edu.ph", isCurrent: false,
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

  it("edits an administrator and leaves a blank password alone", async () => {
    const save = vi.spyOn(services.admins, "save").mockResolvedValue({
      id: "2", username: "admin_renamed", email: "registrar@isu.edu.ph", isCurrent: false,
    });
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit administrator" }));
    expect(screen.getByLabelText("Username")).toHaveValue("admin_registrar");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: "2", username: "admin_renamed", password: "",
    })));
    expect(await screen.findByText("admin_renamed was updated successfully.")).toBeInTheDocument();
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
