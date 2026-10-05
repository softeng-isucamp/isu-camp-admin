import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { Users } from "./Users";

const page = {
  items: [
    { id: "1", username: "maria.santos1", createdAt: "2026-09-12T08:30:00Z", userType: "student" as const },
    { id: "2", username: "legacy.user", createdAt: "2026-09-10T08:30:00Z", userType: null },
  ],
  total: 2, page: 1, pageSize: 10,
};

function renderUsers(initialEntry = "/users") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}><Users /></MemoryRouter>
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

  it("initializes the filter from ?userType=", async () => {
    const list = vi.spyOn(services.users, "list").mockResolvedValue(page);
    renderUsers("/users?userType=Teacher");

    await waitFor(() => expect(list).toHaveBeenCalledWith("", 1, 10, "all", "teacher"));
    expect(screen.getByLabelText("ACCOUNT TYPE")).toHaveValue("teacher");
  });
});
