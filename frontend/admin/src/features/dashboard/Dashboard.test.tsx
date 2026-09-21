import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { DashboardSummary } from "../../types";
import { Dashboard } from "./Dashboard";

const summary: DashboardSummary = {
  buildings: 12,
  buildingChange: 2,
  offices: 34,
  locations: 98,
  pathways: 21,
  searches: 55,
  topSearched: [{ rank: "1", locationId: "Building:42", name: "Library", context: "Student Services", searches: 18 }],
  recent: [{ id: "7", actor: "admin01", action: "Updated Location", target: "Library", createdAt: "Sep 12, 2026", category: "Admin" }],
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
    expect(screen.getByText("+2 this week")).toBeInTheDocument();
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
    expect(screen.getByText("+2 this month")).toBeInTheDocument();
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
