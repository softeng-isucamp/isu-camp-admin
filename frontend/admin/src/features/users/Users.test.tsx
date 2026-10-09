import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { Users } from "./Users";

const page = {
  items: [
    { id: "1", username: "maria.santos1", createdAt: "2026-09-12T08:30:00Z", userType: "student" as const, status: "Active" as const },
    { id: "2", username: "legacy.user", createdAt: "2026-09-10T08:30:00Z", userType: null, status: "Inactive" as const },
  ],
  total: 2, page: 1, pageSize: 10,
};

/** Stands in for the System Logs page so a row's link can be read off the URL. */
function LogsProbe() {
  const location = useLocation();
  return <div data-testid="logs-route">{location.search}</div>;
}

function renderUsers(initialEntry = "/users") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/users" element={<Users />} />
          <Route path="/system-logs" element={<LogsProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Users account type", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders an Account Type column as plain text and a dash for unknown types", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers();

    expect(await screen.findByRole("columnheader", { name: "Account Type" })).toBeInTheDocument();
    await screen.findByText("maria.santos1");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Student");
    expect(rows[2]).toHaveTextContent("—");
  });

  it("filters by account type and resets to the first page", async () => {
    const list = vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers();
    await screen.findByText("maria.santos1");

    await userEvent.selectOptions(screen.getByLabelText("ACCOUNT TYPE"), "visitor");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("", 1, 10, "all", "visitor"));
  });

  it("offers only the actions this portal owns for an app account", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers();
    await screen.findByText("maria.santos1");

    // The profile belongs to the User App; sign-in access is the portal's.
    await userEvent.click(screen.getByRole("button", { name: "Actions for maria.santos1" }));
    const actions = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(actions).toEqual(["View activity", "Deactivate account"]);
  });

  it("shows each account's status and labels the action to match", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers();
    await screen.findByText("maria.santos1");

    expect(within(screen.getByText("maria.santos1").closest("tr")!).getByText("Active")).toBeInTheDocument();
    expect(within(screen.getByText("legacy.user").closest("tr")!).getByText("Inactive")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Actions for legacy.user" }));
    expect(screen.getByRole("menuitem", { name: "Activate account" })).toBeInTheDocument();
  });

  it("deactivates an app account after confirming", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    const setStatus = vi.spyOn(services.users, "setStatus")
      .mockResolvedValue({ ...page.items[0], status: "Inactive" });
    renderUsers();
    await screen.findByText("maria.santos1");

    await userEvent.click(screen.getByRole("button", { name: "Actions for maria.santos1" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Deactivate account" }));

    const dialog = screen.getByRole("dialog", { name: "Deactivate this account?" });
    expect(within(dialog).getByText(/User App's login/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate Account" }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("1", "Inactive"));
    expect(await screen.findByText("maria.santos1 was deactivated successfully.")).toBeInTheDocument();
  });

  it("reactivates an app account without a confirmation step", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    const setStatus = vi.spyOn(services.users, "setStatus")
      .mockResolvedValue({ ...page.items[1], status: "Active" });
    renderUsers();
    await screen.findByText("legacy.user");

    await userEvent.click(screen.getByRole("button", { name: "Actions for legacy.user" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Activate account" }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("2", "Active"));
    expect(await screen.findByText("legacy.user was activated successfully.")).toBeInTheDocument();
  });

  it("keeps the deactivation dialog open and explains a failure", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    vi.spyOn(services.users, "setStatus").mockRejectedValue(new Error("Failed to update the account's status."));
    renderUsers();
    await screen.findByText("maria.santos1");

    await userEvent.click(screen.getByRole("button", { name: "Actions for maria.santos1" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Deactivate account" }));
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Account" }));

    expect(await screen.findByText("Failed to update the account's status.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Deactivate this account?" })).toBeInTheDocument();
  });

  it("links an app account to its recorded activity", async () => {
    vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers();
    await screen.findByText("maria.santos1");

    await userEvent.click(screen.getByRole("button", { name: "Actions for maria.santos1" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "View activity" }));

    const search = new URLSearchParams((await screen.findByTestId("logs-route")).textContent ?? "");
    expect(search.get("q")).toBe("maria.santos1");
    expect(search.get("category")).toBe("User");
  });

  it("initializes the filter from ?userType=", async () => {
    const list = vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers("/users?userType=Teacher");

    await waitFor(() => expect(list).toHaveBeenCalledWith("", 1, 10, "all", "teacher"));
    expect(screen.getByLabelText("ACCOUNT TYPE")).toHaveValue("teacher");
  });
});
