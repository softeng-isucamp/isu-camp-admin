import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { DashboardSummary } from "../../types";
import { formatDateTime } from "../../lib/format";
import { Dashboard } from "./Dashboard";

const summary: DashboardSummary = {
  buildings: 12,
  buildingChange: 2,
  indoorLocations: 34,
  users: 56,
  locations: 98,
  pathways: 21,
  searches: 55,
  topSearched: [{ rank: "1", locationId: "Building:42", name: "Library", context: "Student Services", searches: 18 }],
  recent: [
    { id: "7", actor: "admin01", action: "Updated Location", target: "Library", createdAt: "2026-09-12T08:30:00Z", category: "Admin" },
    { id: "8", actor: "student01", action: "Searched Location", target: "Library", createdAt: "Sep 12, 2026", category: "User" },
  ],
};

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
        <RouteProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="dashboard-route">{location.pathname}{location.search}</output>;
}

describe("Dashboard backend boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the default range and refetches when the analytics range changes", async () => {
    const request = vi.spyOn(services.dashboard, "summary").mockResolvedValue(summary);
    renderDashboard();

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("week");
    expect(screen.getByText("+2 added this week")).toBeInTheDocument();
    expect(screen.getAllByText("Indoor Locations")).toHaveLength(2);
    expect(screen.getByText("Registered Users")).toBeInTheDocument();
    expect(screen.getByText("56")).toBeInTheDocument();
    expect(screen.getByText("Campus Map Preview")).toBeInTheDocument();
    expect(screen.getByText("Buildings")).toBeInTheDocument();
    expect(screen.getAllByText("Indoor Locations")).toHaveLength(2);
    expect(screen.getByText("Walking Network")).toBeInTheDocument();
    expect(screen.getByText("Updated Location")).toBeInTheDocument();
    expect(screen.getByText(formatDateTime("2026-09-12T08:30:00Z"))).toBeInTheDocument();
    expect(screen.queryByText("2026-09-12T08:30:00Z")).not.toBeInTheDocument();
    expect(screen.queryByText("Searched Location")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Registered Users"));
    expect(screen.getByTestId("dashboard-route")).toHaveTextContent("/users");
    const rankedLibrary = screen.getByTitle("View Library in directory");
    expect(within(rankedLibrary).getByText("Library")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("Student Services")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("18")).toBeInTheDocument();
    await userEvent.click(rankedLibrary);
    expect(screen.getByTestId("dashboard-route")).toHaveTextContent(
      "/locations?q=Library&locationKey=Building%3A42",
    );

    await userEvent.selectOptions(screen.getByLabelText("Top searched time range"), "month");
    await waitFor(() => expect(request).toHaveBeenCalledWith("month"));
    expect(screen.getByText("+2 added this month")).toBeInTheDocument();
  });

  it("shows an actionable error when the backend request fails", async () => {
    vi.spyOn(services.dashboard, "summary").mockRejectedValue(new Error("Service unavailable"));
    renderDashboard();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load the dashboard. Service unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Search analytics are unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Recent activity is unavailable.")).toBeInTheDocument();
  });
});
