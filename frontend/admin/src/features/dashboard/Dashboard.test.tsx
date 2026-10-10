import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { generateDashboardAnalytics } from "../../services/fixtures/dashboardAnalytics";
import { locations } from "../../services/mockData";
import type { DashboardAnalytics, DashboardRange, DashboardSummary } from "../../types";
import { formatDateTime } from "../../lib/format";
import { Dashboard } from "./Dashboard";

const summary: DashboardSummary = {
  buildings: 12,
  buildingChange: 2,
  indoorLocations: 34,
  users: 56,
  usersByType: { student: 40, teacher: 11, visitor: 5 },
  locations: 98,
  pathways: 21,
  searches: 55,
  topSearched: [{ rank: "1", locationId: "Building:42", name: "Library", context: "Student Services", searches: 18 }],
  recent: [
    { id: "7", actor: "admin01", action: "Updated Location", target: "Library", createdAt: "2026-09-12T08:30:00Z", category: "Admin" },
    { id: "8", actor: "student01", action: "Searched Location", target: "Library", createdAt: "Sep 12, 2026", category: "User" },
  ],
};

const analytics = (range: DashboardRange = "week"): DashboardAnalytics => ({
  ...generateDashboardAnalytics(range, locations),
  topDestinations: [{ rank: "1", locationId: "Building:42", name: "Library", context: "Student Services", searches: 18, visits: 9 }],
});

beforeAll(() => {
  // jsdom has no ResizeObserver, which Recharts' ResponsiveContainer needs.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

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
    vi.spyOn(services.dashboard, "analytics").mockImplementation(async (range) => analytics(range));
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
    await userEvent.click(screen.getByRole("button", { name: "View Student accounts" }));
    expect(screen.getByTestId("dashboard-route")).toHaveTextContent("/users?userType=student");
    const rankedLibrary = screen.getByTitle("View Library in directory");
    expect(within(rankedLibrary).getByText("Library")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("Student Services")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("18")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("9")).toBeInTheDocument();
    expect(within(rankedLibrary).getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Top Destinations")).toBeInTheDocument();
    await userEvent.click(rankedLibrary);
    expect(screen.getByTestId("dashboard-route")).toHaveTextContent(
      "/locations?q=Library&locationKey=Building%3A42",
    );

    await userEvent.selectOptions(screen.getByLabelText("Dashboard time range"), "month");
    await waitFor(() => expect(request).toHaveBeenCalledWith("month"));
    expect(screen.getByText("+2 added this month")).toBeInTheDocument();
  });

  it("shows an actionable error when the backend request fails", async () => {
    vi.spyOn(services.dashboard, "summary").mockRejectedValue(new Error("Service unavailable"));
    vi.spyOn(services.dashboard, "analytics").mockRejectedValue(new Error("Service unavailable"));
    renderDashboard();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load the dashboard. Service unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Search analytics are unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Recent activity is unavailable.")).toBeInTheDocument();
  });

  it("shows the account type split with percentages, counts, and filtered links", async () => {
    vi.spyOn(services.dashboard, "summary").mockResolvedValue(summary);
    vi.spyOn(services.dashboard, "analytics").mockImplementation(async (range) => analytics(range));
    renderDashboard();

    const teacher = await screen.findByRole("button", { name: "View Staff accounts" });
    expect(within(teacher).getByText("20%")).toBeInTheDocument();
    expect(within(teacher).getByText("11")).toBeInTheDocument();
    const student = screen.getByRole("button", { name: "View Student accounts" });
    expect(within(student).getByText("71%")).toBeInTheDocument();
    expect(within(student).getByText("40")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "View Visitor accounts" })).getByText("9%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Registered users by account type" })).toBeInTheDocument();
    expect(screen.getByText("Visitor: 5 (9%)")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Staff: 11 (20%)"));
    expect(screen.getByTestId("dashboard-route")).toHaveTextContent("/users?userType=teacher");
  });

  it("shows the total and dashes when the backend omits the account type split", async () => {
    vi.spyOn(services.dashboard, "summary").mockResolvedValue({ ...summary, usersByType: null });
    vi.spyOn(services.dashboard, "analytics").mockImplementation(async (range) => analytics(range));
    renderDashboard();

    const student = await screen.findByRole("button", { name: "View Student accounts" });
    expect(within(student).getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("56")).toBeInTheDocument();
  });

  it("renders the Analytics tab sections from fixture data", async () => {
    vi.spyOn(services.dashboard, "summary").mockResolvedValue(summary);
    renderDashboard();

    await userEvent.click(screen.getByRole("tab", { name: "Analytics" }));
    expect(await screen.findByRole("heading", { name: "App Usage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Health" })).toBeInTheDocument();
    expect(await screen.findByText("Active users")).toBeInTheDocument();
    for (const title of ["Searches & Visits", "Visits by account type", "Visits by destination type", "New registrations", "Directory completeness"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /Photo/ })).toHaveAttribute("href", "/locations");
  });

  it("explains that analytics are unavailable when the endpoint fails", async () => {
    vi.spyOn(services.dashboard, "summary").mockResolvedValue(summary);
    vi.spyOn(services.dashboard, "analytics").mockRejectedValue(new Error("Not found"));
    renderDashboard();

    await userEvent.click(screen.getByRole("tab", { name: "Analytics" }));
    expect(await screen.findByText("Analytics are not available from the backend yet.")).toBeInTheDocument();
  });
});
