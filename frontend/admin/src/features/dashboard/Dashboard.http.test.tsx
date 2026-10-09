import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { Dashboard } from "./Dashboard";

vi.mock("../../services/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../services/api")>(),
  USE_HTTP_API: true,
}));

afterEach(() => vi.restoreAllMocks());

it("keeps HTTP Overview searches usable without the future analytics endpoint", async () => {
  vi.spyOn(services.dashboard, "summary").mockResolvedValue({
    buildings: 1, buildingChange: null, indoorLocations: 0, users: 0,
    usersByType: null, locations: 1, pathways: 0, searches: 18, recent: [],
    topSearched: [{ rank: "1", locationId: "Building:42", name: "Library", context: "Building", searches: 18 }],
  });
  const analytics = vi.spyOn(services.dashboard, "analytics").mockRejectedValue(new Error("Not found"));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );

  const destination = await screen.findByTitle("View Library in directory");
  expect(within(destination).getByText("18")).toBeInTheDocument();
  expect(within(destination).queryByText("visits")).not.toBeInTheDocument();
  expect(within(destination).queryByText("arrival rate")).not.toBeInTheDocument();
  expect(analytics).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("tab", { name: "Analytics" }));
  expect(await screen.findByText("Analytics are not available from the backend yet.")).toBeInTheDocument();
  expect(analytics).toHaveBeenCalledWith("week");
});
