import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { generateDecisionAnalytics } from "../../services/fixtures/decisionAnalytics";
import { locations } from "../../services/mockData";
import { signInAs } from "../../test/session";
import { AnalyticsPage } from "./AnalyticsPage";

beforeAll(() => {
  // jsdom has no ResizeObserver, which Recharts' ResponsiveContainer needs.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  signInAs("admin");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AnalyticsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the five charts and refetches searches for another range", async () => {
  const request = vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async (range = "week") => generateDecisionAnalytics(range, locations));
  renderPage();

  for (const title of ["Directory readiness", "Closure impact", "Reach by travel mode", "Searches by account type", "Searches by destination type"]) {
    expect(await screen.findByText(title)).toBeInTheDocument();
  }
  await userEvent.selectOptions(screen.getByRole("combobox"), "month");
  expect(request).toHaveBeenCalledWith("month");
});

it("explains a failed load and retries on request", async () => {
  const request = vi.spyOn(services.dashboard, "decisionAnalytics").mockRejectedValue(new Error("Gateway timeout"));
  renderPage();

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  request.mockImplementation(async (range = "week") => generateDecisionAnalytics(range, locations));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Directory readiness")).toBeInTheDocument();
});

it("says what to fix when the server finds no main gate", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...generateDecisionAnalytics("week", locations), reach: null, closures: [] });
  renderPage();

  expect(await screen.findByText(/Main Gate" in the Map Editor/)).toBeInTheDocument();
  expect(screen.getByText(/No single pathway closure/)).toBeInTheDocument();
});

it("offers calendar years from the first recorded year and labels searches with the year", async () => {
  const request = vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async (range = "week") => ({
    ...generateDecisionAnalytics(range, locations),
    firstAnalyticsYear: 2024,
  }));
  renderPage();

  const select = await screen.findByRole("combobox", { name: "Search time range" });
  await waitFor(() => expect(select).toBeEnabled());
  const currentYear = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date()));
  expect(screen.getByRole("option", { name: `This year (${currentYear})` })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "2024" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "2023" })).not.toBeInTheDocument();

  await userEvent.selectOptions(select, "year-2024");
  expect(request).toHaveBeenCalledWith("year-2024");
  expect(await screen.findByText(/searches in 2024$/)).toBeInTheDocument();
});

