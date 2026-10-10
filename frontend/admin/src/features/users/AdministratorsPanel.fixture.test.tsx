import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import * as AuthContext from "../auth/AuthContext";
import { Users } from "./Users";

// The panel over the real fixture backend: nothing about administrators is mocked, so these
// follow the fixture's own confirmation window and refusals. The fixture lives in module
// memory, which is why this is its own file.

const PASSWORD = "password123";

function renderSignedIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.AuthProvider>
        <MemoryRouter initialEntries={["/users"]}>
          <Users />
        </MemoryRouter>
      </AuthContext.AuthProvider>
    </QueryClientProvider>,
  );
}

async function openAdministrators() {
  renderSignedIn();
  fireEvent.click(await screen.findByRole("button", { name: "Administrators" }));
  await screen.findByText("admin_registrar");
  await screen.findByRole("button", { name: /add administrator/i });
}

const openRowMenu = (username: string) => fireEvent.click(screen.getByRole("button", { name: `Actions for ${username}` }));
const typePassword = () => fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: PASSWORD } });

describe("Administrator accounts over the fixture backend", () => {
  beforeEach(async () => {
    vi.spyOn(services.users, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    await services.auth.login("admin_justine", PASSWORD);
  });
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await services.auth.logout();
  });

  it("promotes and demotes after the panel confirms the password", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    typePassword();
    fireEvent.click(screen.getByRole("button", { name: "Make Superadmin" }));
    expect(await screen.findByText("admin_registrar was promoted to superadmin successfully.")).toBeInTheDocument();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make administrator" }));
    typePassword();
    fireEvent.click(screen.getByRole("button", { name: "Make Administrator" }));
    expect(await screen.findByText("admin_registrar was demoted to administrator successfully.")).toBeInTheDocument();
  });

  it("shows a wrong password in the field and goes no further", async () => {
    await openAdministrators();

    openRowMenu("admin_registrar");
    fireEvent.click(screen.getByRole("menuitem", { name: "Make superadmin" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Make Superadmin" }));

    expect(await screen.findByText("Password is incorrect")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Superadmin" })).toBeInTheDocument();
    expect((await services.admins.list()).find((account) => account.username === "admin_registrar")?.role).toBe("admin");
  });

  it("adds a superadmin and an administrator, then removes the superadmin", async () => {
    await openAdministrators();

    fireEvent.click(screen.getByRole("button", { name: /add administrator/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin_boss" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "boss@isu.edu.ph" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-enough-secret" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
    typePassword();
    fireEvent.click(screen.getByRole("button", { name: "Add Administrator" }));
    expect(await screen.findByText("admin_boss was added successfully.")).toBeInTheDocument();

    openRowMenu("admin_boss");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove administrator" }));
    typePassword();
    fireEvent.click(screen.getByRole("button", { name: "Remove Administrator" }));
    expect(await screen.findByText("admin_boss was removed successfully.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("admin_boss")).not.toBeInTheDocument());
  });
});
