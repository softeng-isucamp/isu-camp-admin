import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { normalizeBackendDecisionAnalytics, services } from "../../services/api";
import { bucketAxisLabel, bucketTooltipLabel } from "./SearchCharts";
import { generateDecisionAnalytics } from "../../services/fixtures/decisionAnalytics";
import { locations } from "../../services/mockData";
import { signInAs } from "../../test/session";
import { AnalyticsPage } from "./AnalyticsPage";
import { nameSummary } from "./ClickTip";
import { fitLabel } from "./RowLabelTick";
import { accountTypes } from "../../lib/accountType";

function Where() {
  const where = useLocation();
  return <output data-testid="where">{where.pathname}{where.search}</output>;
}

beforeAll(() => {
  // jsdom has no layout: report a fixed size so Recharts' ResponsiveContainer draws the bars.
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = { width: 640, height: 300 };
      this.callback([{ target, contentRect: { ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON() {} }, borderBoxSize: [{ inlineSize: size.width, blockSize: size.height }], contentBoxSize: [{ inlineSize: size.width, blockSize: size.height }], devicePixelContentBoxSize: [] } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  signInAs("admin");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AnalyticsPage /><Where /></MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the five charts and refetches searches for another range", async () => {
  const request = vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async (range = "week") => generateDecisionAnalytics(range, locations));
  renderPage();

  for (const title of ["Missing details", "Closure impact", "Reach by access type", "Search activity", "Indoor marker coverage"]) {
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
  expect(await screen.findByText("Missing details")).toBeInTheDocument();
});

it("says what to fix when the server finds no main gate", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...generateDecisionAnalytics("week", locations), reach: null, closures: null });
  renderPage();

  expect(await screen.findByText(/to measure reach/)).toBeInTheDocument();
  expect(screen.getByText(/to measure closures/)).toBeInTheDocument();
  expect(screen.queryByText(/No single pathway closure/)).not.toBeInTheDocument();
});

it("says no closure matters only when closures were measured", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...generateDecisionAnalytics("week", locations), closures: [] });
  renderPage();

  expect(await screen.findByText(/No single pathway closure/)).toBeInTheDocument();
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


const fixture = () => generateDecisionAnalytics("week", locations);
const destination = () => {
  const [path, query] = screen.getByTestId("where").textContent!.split("?");
  return { path, params: new URLSearchParams(query) };
};
/** The bar segments of the chart titled `title`, in draw order (one per row per bar series). */
const segments = (title: string) => {
  const block = screen.getByRole("heading", { name: title }).closest(".graph") as HTMLElement;
  return Array.from(block.querySelectorAll(".recharts-bar")).map((bar) => Array.from(bar.querySelectorAll(".recharts-bar-rectangle path, .recharts-bar-rectangle rect")));
};

it("opens the reading guide as a floating popover that closes on Esc, outside click and the button, and returns focus", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  const button = await screen.findByRole("button", { name: "How to read Closure impact" });
  expect(button).not.toHaveAttribute("title");
  expect(button).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(button);
  const popover = screen.getByRole("dialog", { name: "How to read Closure impact" });
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(button).toHaveAttribute("aria-controls", popover.id);
  expect(popover).toHaveClass("graph-help");
  expect(popover.parentElement).toHaveClass("graph-info-anchor");

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(button).toHaveFocus();

  await userEvent.click(button);
  await userEvent.click(within(screen.getByRole("dialog")).getByText(/^Data:/));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("heading", { name: "Reach by access type" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // Clicking plain content would drop focus to <body>; it goes back to the (i) button instead.
  await waitFor(() => expect(button).toHaveFocus());

  // Clicking another control closes the guide but leaves focus on that control.
  await userEvent.click(button);
  const other = screen.getByRole("button", { name: "How to read Reach by access type" });
  fireEvent.mouseDown(other);
  other.focus();
  expect(screen.queryByRole("dialog", { name: "How to read Closure impact" })).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(other).toHaveFocus();

  await userEvent.click(button);
  await userEvent.click(button);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});

it("keeps a tooltip to a few names and a long axis label to its axis", () => {
  const places = ["A", "B", "C", "D", "E"].map((name) => ({ id: name, name }));
  expect(nameSummary(places)).toBe("A, B, C +2 more");
  expect(nameSummary(places.slice(0, 2))).toBe("A, B");
  const long = "Entrance Junction - Junction Gate";
  expect(fitLabel(long, 184).length).toBeLessThan(long.length);
  expect(fitLabel(long, 184).endsWith("…")).toBe(true);
  expect(fitLabel("Walking", 86)).toBe("Walking");
  expect(fitLabel(long, 0)).toBe(long);
  // Fitting uses rendered width, not character count: wide glyphs are cut sooner than narrow ones.
  const wide = (value: string) => [...value].reduce((sum, ch) => sum + (ch === "W" ? 12 : 5), 0);
  const ws = "W".repeat(28);
  const cut = fitLabel(ws, 184, wide);
  expect(cut.endsWith("…")).toBe(true);
  expect(wide(cut)).toBeLessThanOrEqual(184 - 8);
  expect(fitLabel("i".repeat(28), 184, wide)).toBe("i".repeat(28));
  // Room for less than one wide character plus the ellipsis leaves only the ellipsis.
  expect(fitLabel("WW", 20, wide)).toBe("…");
});

it("opens a closure's cut-off and longer-walk places from the two parts of its bar", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Closure impact");
    const worst = fixture().closures![0];

  fireEvent.click(segments("Closure impact")[0][0]);
  let { path, params } = destination();
  expect(path).toBe("/locations");
  expect(params.get("ids")).toBe(worst.cutOff.map((place) => place.id).join(","));
  expect(params.get("why")).toBe(`Cut off if ${worst.pathway} closes`);

  fireEvent.click(segments("Closure impact")[1][0]);
  ({ path, params } = destination());
  expect(path).toBe("/locations");
  expect(params.get("ids")).toBe(worst.longerPlaces!.map((place) => place.id).join(","));
  expect(params.get("why")).toBe(`Longer walk if ${worst.pathway} closes`);

  fireEvent.click(screen.getByRole("link", { name: new RegExp(`^${worst.pathway}: open this pathway`) }));
  expect(destination()).toMatchObject({ path: "/map-editor" });
  expect(destination().params.get("pathway")).toBe(worst.id);
});

it("opens the reachable and unreachable places from the two parts of an access type's bar", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Reach by access type");
  const vehicle = fixture().reach!.modes.findIndex((mode) => mode.mode === "Vehicle");
  const mode = fixture().reach!.modes[vehicle];

  fireEvent.click(segments("Reach by access type")[0][vehicle]);
  expect(destination().params.get("ids")).toBe(mode.reachablePlaces!.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe("Reachable by vehicle");

  fireEvent.click(segments("Reach by access type")[1][vehicle]);
  expect(destination().params.get("ids")).toBe(mode.unreachable.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe("Not reachable by vehicle");
});

/** The readiness checks in the order the chart ranks them: the biggest gap first. */
const rankedChecks = () => fixture().readiness.checks
  .map((check) => ({ ...check, missingCount: check.total - check.complete }))
  .sort((a, b) => b.missingCount - a.missingCount || b.total - a.total || a.label.localeCompare(b.label));

it("ranks the missing details by gap size and shows each applicable total instead of a fully-ready score", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Missing details");

  expect(screen.queryByText(/fully ready/i)).not.toBeInTheDocument();
  const ranked = rankedChecks();
  const block = screen.getByRole("heading", { name: "Missing details" }).closest(".graph") as HTMLElement;
  const labels = Array.from(block.querySelectorAll("text")).map((node) => node.textContent);
  const shown = labels.filter((text) => /\d+ missing$/.test(text ?? ""));
  expect(shown).toEqual(ranked.map((row) => (row.missingCount ? `${row.missingCount} of ${row.total} missing` : `none of ${row.total} missing`)));
  // Ranked: the biggest gap comes first.
  expect(ranked.map((row) => row.missingCount)).toEqual([...ranked.map((row) => row.missingCount)].sort((a, b) => b - a));
  // Each check keeps its own applicable total: rooms ask only the places that may hold them.
  const rooms = ranked.find((row) => row.key === "rooms")!;
  expect(rooms.total).toBeLessThan(fixture().readiness.total);
  // Every check with a gap stays reachable by keyboard through its row label.
  for (const row of ranked.filter((check) => check.missing.length)) {
    expect(screen.getByRole("link", { name: `${row.label}: list the ${row.missing.length} places missing it in Locations` })).toBeInTheDocument();
  }
});

it("opens the places missing a check from its red part and those that have it from its pale part", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Missing details");
  // Recharts draws no rectangle for an empty part, so the first drawn part belongs to the first ranked check that has one.
  const ranked = rankedChecks();
  const without = ranked.find((check) => check.missing.length)!;
  const withIt = ranked.find((check) => check.have?.length)!;

  fireEvent.click(segments("Missing details")[0][0]);
  expect(destination().path).toBe("/locations");
  expect(destination().params.get("ids")).toBe(without.missing.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe(`Missing ${without.label.toLowerCase()}`);

  fireEvent.click(segments("Missing details")[1][0]);
  expect(destination().params.get("ids")).toBe(withIt.have!.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe(`With ${withIt.label.toLowerCase()}`);
});

it("checks only what stays unfinished after a save: photo, keywords, entrance and indoor locations", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Missing details");
  const block = screen.getByRole("heading", { name: "Missing details" }).closest(".graph") as HTMLElement;
  const text = Array.from(block.querySelectorAll("text")).map((node) => node.textContent ?? "").join("|");
  for (const label of ["Photo", "Search keywords", "Entrance linked", "Indoor locations"]) expect(text).toContain(label);
  // The forms require a description and the Map Editor sets the position, so neither is a task to count here.
  expect(text).not.toMatch(/Description|Map pin|Indoor rooms/);
  expect(fixture().readiness.checks.map((check) => check.key).sort()).toEqual(["entrance", "keywords", "photo", "rooms"]);
  // One Walking bar and one Vehicle bar: bicycle, motorcycle and car share a single pathway permission.
  expect(fixture().reach!.modes.map((mode) => mode.mode)).toEqual(["Walking", "Vehicle"]);
});

it("titles each group by what it covers, not as a question", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Missing details");
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Directory completeness", "Route network", "Search demand"]);
});

it("counts every active indoor location under an active place, searched or not, and skips rooms with no active building", () => {
  const room = locations.find((item) => item.type === "Room" && item.status === "Active" && item.parentId)!;
  const orphanRoom = { ...room, id: "orphan-room", parentId: "missing-parent" };
  const marked = { ...room, id: "marked-room", name: "Marked Room", positioned: true, lat: 1, lng: 2 };
  const rooms = (list: typeof locations) => generateDecisionAnalytics("week", list).readiness.indoorMarkers.find((row) => row.type === "Room")!;
  const before = rooms(locations);
  const after = rooms([...locations, orphanRoom, marked]);

  expect(after.total).toBe(before.total + 1);
  expect(after.marked).toBe(before.marked + 1);
  expect(after.have.map((item) => item.id)).toContain("marked-room");
  expect([...after.missing, ...after.have].map((item) => item.id)).not.toContain("orphan-room");
  expect(after.missing.length + after.have.length).toBe(after.total);
});

it("leaves the half of a bar a server sent no list for unclickable", async () => {
  const base = fixture();
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    closures: base.closures!.map(({ longerPlaces: _longer, ...row }) => row),
  });
  renderPage();
  await screen.findByText("Closure impact");
  fireEvent.click(segments("Closure impact")[1][0]);
  expect(destination().path).toBe("/");
  expect(segments("Closure impact")[1][0]).toHaveAttribute("cursor", "default");
  expect(segments("Closure impact")[0][0]).toHaveAttribute("cursor", "pointer");
});

it("leaves the reachable and readiness 'has it' halves unclickable when an older server sends no list", async () => {
  const base = fixture();
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    readiness: { ...base.readiness, checks: base.readiness.checks.map(({ have: _have, ...check }) => check) },
    reach: { ...base.reach!, modes: base.reach!.modes.map(({ reachablePlaces: _reachable, ...mode }) => mode) },
  });
  renderPage();
  await screen.findByText("Reach by access type");

  const reached = segments("Reach by access type")[0][0];
  expect(reached).toHaveAttribute("cursor", "default");
  fireEvent.click(reached);
  expect(destination().path).toBe("/");

  const ready = segments("Missing details")[1][0];
  expect(ready).toHaveAttribute("cursor", "default");
  fireEvent.click(ready);
  expect(destination().path).toBe("/");

  // The halves an older server does send still open their places.
  fireEvent.click(segments("Missing details")[0][0]);
  expect(destination().path).toBe("/locations");
});

it("keeps the optional place lists for the other half of each bar when the server sends them", () => {
  const parsed = normalizeBackendDecisionAnalytics(fixture());
  expect(parsed.readiness.checks[0].have).toEqual(fixture().readiness.checks[0].have);
  expect(parsed.closures![0].longerPlaces).toEqual(fixture().closures![0].longerPlaces);
  expect(parsed.reach!.modes[0].reachablePlaces).toEqual(fixture().reach!.modes[0].reachablePlaces);
});

it("labels a detour-only closure as longer walks, never as safe to close", async () => {
  const base = fixture();
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue(base);
  renderPage();
  await screen.findByText("Closure impact");

  expect(base.closures!.some((row) => !row.cutOff.length)).toBe(true);
  expect(screen.getByText("detour only")).toBeInTheDocument();
  expect(screen.queryByText("safe")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "How to read Closure impact" }));
  const guide = screen.getByRole("dialog", { name: "How to read Closure impact" });
  expect(within(guide).queryByText(/safe to close/i)).not.toBeInTheDocument();
  expect(guide).toHaveTextContent("not proof that closing it is safe");
  expect(guide).toHaveTextContent("whether or not anyone searches");
});

it("draws unreachable destinations in the neutral grey, not the alert red", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Reach by access type");

  const unreachable = segments("Reach by access type")[1][0];
  expect(unreachable.getAttribute("fill")).toBe("#8a948f");
  expect(unreachable.getAttribute("fill")).not.toBe("#d64545");
});

it("tags the current-snapshot graphs apart from the range-dependent search graphs", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async (range = "week") => generateDecisionAnalytics(range, locations));
  renderPage();
  await screen.findByText("Missing details");

  expect(screen.getAllByText("Current snapshot")).toHaveLength(2);
  expect(screen.getByText(/searches this week$/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox"), "month");
  expect(await screen.findByText(/searches this month$/)).toBeInTheDocument();
  expect(screen.getAllByText("Current snapshot")).toHaveLength(2);
});

it("accepts the new contract and rejects the removed fully-ready shape's replacement being malformed", () => {
  const parsed = normalizeBackendDecisionAnalytics(fixture());
  expect(parsed.searches.activity.points).toEqual(fixture().searches.activity.points);
  expect(parsed.readiness.indoorMarkers).toEqual(fixture().readiness.indoorMarkers);
  expect(() => normalizeBackendDecisionAnalytics({ ...fixture(), searches: { ...fixture().searches, activity: { bucket: "month", points: [] } } })).toThrow();
  // Places are not part of marker coverage: their position comes from the footprint.
  expect(() => normalizeBackendDecisionAnalytics({ ...fixture(), readiness: { ...fixture().readiness, indoorMarkers: [{ type: "Building", total: 1, marked: 0, missing: [], have: [] }] } })).toThrow();
});

it("builds a fixture whose searches add up across the time series and the account types", () => {
  for (const range of ["week", "month", "all", "year-2026"] as const) {
    const { searches } = generateDecisionAnalytics(range, locations);
    const { points, bucket } = searches.activity;
    expect(bucket).toBe(range === "week" || range === "month" ? "day" : "week");
    expect(points.length).toBe(range === "week" ? 7 : range === "month" ? 30 : points.length);
    expect(points.reduce((sum, point) => sum + point.total, 0)).toBe(searches.total);
    for (const point of points) expect(point.student + point.teacher + point.visitor).toBe(point.total);
    expect(searches.byAccountType.student + searches.byAccountType.teacher + searches.byAccountType.visitor).toBe(searches.total);
  }
});

it("plots search activity as a stacked time series with named axes and consistent account colours", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async (range = "week") => generateDecisionAnalytics(range, locations));
  renderPage();
  await screen.findByText("Search activity");
  const block = screen.getByRole("heading", { name: "Search activity" }).closest(".graph") as HTMLElement;

  expect(within(block).getByText("Searches per day")).toBeInTheDocument();
  expect(within(block).getByText("Day")).toBeInTheDocument();
  // One stacked series per account type, in the shared account colours.
  const fills = Array.from(block.querySelectorAll(".recharts-bar")).map((bar) => bar.querySelector("path, rect")?.getAttribute("fill"));
  expect(fills).toEqual(accountTypes.map((type) => type.color));

  await userEvent.selectOptions(screen.getByRole("combobox"), "all");
  expect(await within(block).findByText("Searches per week")).toBeInTheDocument();
  expect(within(block).getByText("Week starting")).toBeInTheDocument();
});

it("opens an account type's accounts from the Search activity legend", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Search activity");

  await userEvent.click(screen.getByRole("button", { name: /^Staff: \d+ searches?\. Open Staff accounts in User Management$/ }));
  expect(destination().path).toBe("/users");
  expect(destination().params.get("userType")).toBe("teacher");
});

it("says what a search is not, and shows an empty state when nothing was searched", async () => {
  const base = fixture();
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    searches: { ...base.searches, total: 0, byAccountType: { student: 0, teacher: 0, visitor: 0 }, activity: { bucket: "day", points: base.searches.activity.points.map((point) => ({ ...point, total: 0, student: 0, teacher: 0, visitor: 0 })) } },
  });
  renderPage();
  expect(await screen.findByText("No searches were recorded in this range.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "How to read Search activity" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("not visits, arrivals, unique people or route attempts");
});

/** The indoor marker rows in the order the chart ranks them: the most unmarked first. */
const rankedMarkers = () => [...fixture().readiness.indoorMarkers].sort((a, b) => (b.total - b.marked) - (a.total - a.marked) || b.total - a.total || a.type.localeCompare(b.type));
const markerLabels = { Room: "Rooms", Laboratory: "Laboratories", Office: "Offices", Restroom: "Restrooms" } as const;

it("counts indoor locations with and without a marker, searched or not, and lists no Places row", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Indoor marker coverage");
  const block = screen.getByRole("heading", { name: "Indoor marker coverage" }).closest(".graph") as HTMLElement;
  const text = Array.from(block.querySelectorAll("text")).map((node) => node.textContent ?? "");

  const expected = rankedMarkers().map((row) => (row.total ? `${row.total - row.marked} of ${row.total} · ${Math.round(((row.total - row.marked) / row.total) * 100)}%` : "none yet"));
  expect(text.filter((value) => / of \d+ · \d+%$|^none yet$/.test(value))).toEqual(expected);
  expect(text).not.toContain("Places");
  expect(text).toContain("Active indoor locations");
  expect(fixture().readiness.indoorMarkers.map((row) => row.type)).toEqual(["Room", "Laboratory", "Office", "Restroom"]);
  for (const row of fixture().readiness.indoorMarkers) expect(row.missing.length + row.have.length).toBe(row.total);
});

it("opens the indoor locations with no marker from the red part and those with one from the blue part, by typed key", async () => {
  const base = fixture();
  const rooms = base.readiness.indoorMarkers.find((row) => row.type === "Room")!;
  const mixed = { ...rooms, total: rooms.total + 2, marked: 2, have: [{ id: "12", name: "Marked A" }, { id: "13", name: "Marked B" }] };
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    readiness: { ...base.readiness, indoorMarkers: base.readiness.indoorMarkers.map((row) => (row.type === "Room" ? mixed : row)) },
  });
  renderPage();
  await screen.findByText("Indoor marker coverage");
  const ranked = [...base.readiness.indoorMarkers.map((row) => (row.type === "Room" ? mixed : row))]
    .sort((a, b) => (b.total - b.marked) - (a.total - a.marked) || b.total - a.total || a.type.localeCompare(b.type));
  const first = ranked[0];

  fireEvent.click(segments("Indoor marker coverage")[0][0]);
  expect(destination().path).toBe("/locations");
  expect(destination().params.get("keys")).toBe(first.missing.map((item) => `${first.type}:${item.id}`).join(","));
  expect(destination().params.get("why")).toBe(`${markerLabels[first.type]} with no marker`);
  expect(destination().params.get("ids")).toBeNull();

  fireEvent.click(segments("Indoor marker coverage")[1][0]);
  expect(destination().params.get("keys")).toBe("Room:12,Room:13");
  expect(destination().params.get("why")).toBe("Rooms with a marker");
});

it("says an unmarked indoor location is still opened at its building, and that searches do not decide the list", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Indoor marker coverage");
  await userEvent.click(screen.getByRole("button", { name: "How to read Indoor marker coverage" }));
  const guide = screen.getByRole("dialog");
  expect(guide).toHaveTextContent("still opens an unmarked indoor location at its building");
  expect(guide).toHaveTextContent("only the exact spot is missing");
  expect(guide).toHaveTextContent("whether or not anyone has searched for it");
  expect(screen.queryByText("Searches for destinations without markers")).not.toBeInTheDocument();
});

it("plots searches from deleted or unrecognised accounts as a neutral Unattributed stack so a column's height is its total", async () => {
  const base = fixture();
  const points = base.searches.activity.points.map((point, index) => (index === 6 ? { ...point, total: point.total + 4 } : point));
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...base, searches: { ...base.searches, total: base.searches.total + 4, activity: { ...base.searches.activity, points } } });
  renderPage();
  await screen.findByText("Search activity");
  const block = screen.getByRole("heading", { name: "Search activity" }).closest(".graph") as HTMLElement;

  expect(within(block).getByText("Unattributed")).toBeInTheDocument();
  expect(block.querySelectorAll(".recharts-bar")).toHaveLength(accountTypes.length + 1);
  const lastBar = Array.from(block.querySelectorAll(".recharts-bar")).at(-1)!;
  expect(lastBar.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(1);
});

it("does not show an Unattributed series when every search belongs to an account type", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Search activity");
  expect(screen.queryByText("Unattributed")).not.toBeInTheDocument();
});

it("gives the marker chart keyboard access to both groups: the row label, plus the count label on a row with both", async () => {
  const base = fixture();
  const rooms = base.readiness.indoorMarkers.find((row) => row.type === "Room")!;
  const mixed = { ...rooms, total: rooms.total + 1, marked: 1, have: [{ id: "marked-room", name: "Marked Room" }] };
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    readiness: { ...base.readiness, indoorMarkers: base.readiness.indoorMarkers.map((row) => (row.type === "Room" ? mixed : row)) },
  });
  renderPage();
  await screen.findByText("Indoor marker coverage");

  // A mixed row: the label opens the unmarked ones, the count label the marked ones.
  await userEvent.click(screen.getByRole("link", { name: `Rooms: list the ${mixed.missing.length} rooms with no marker in Locations` }));
  expect(destination().params.get("keys")).toBe(mixed.missing.map((item) => `Room:${item.id}`).join(","));
  const have = screen.getByRole("link", { name: "Rooms: list the 1 rooms with a marker in Locations" });
  have.focus();
  await userEvent.keyboard("{Enter}");
  expect(destination().params.get("keys")).toBe("Room:marked-room");
});

it("gives Missing details keyboard access to the places that have a check as well as those missing it", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Missing details");
  const ranked = rankedChecks();
  const done = ranked.find((row) => !row.missing.length && row.have?.length)!;
  fireEvent.click(screen.getByRole("link", { name: `${done.label}: list the ${done.have!.length} places that have it in Locations` }));
  expect(destination().params.get("ids")).toBe(done.have!.map((place) => place.id).join(","));
  const mixed = ranked.find((row) => row.missing.length && row.have?.length)!;
  fireEvent.click(screen.getByRole("link", { name: `${mixed.label}: list the ${mixed.have!.length} places that have it in Locations` }));
  expect(destination().params.get("why")).toBe(`With ${mixed.label.toLowerCase()}`);
});

it("opens the cut-off and longer-walk lists from keyboard links, including a detour-only pathway", async () => {
  const base = fixture();
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...base, reach: base.reach });
  renderPage();
  await screen.findByText("Closure impact");
  const rows = [...base.closures!].sort((a, b) => b.cutOff.length - a.cutOff.length || b.longerTrip - a.longerTrip);
  const withCut = rows.find((row) => row.cutOff.length && row.longerPlaces?.length)!;
  const detourOnly = rows.find((row) => !row.cutOff.length && row.longerPlaces?.length)!;
  expect(detourOnly).toBeDefined();

  const cut = screen.getByRole("link", { name: `${withCut.pathway}: list the ${withCut.cutOff.length} ${withCut.cutOff.length === 1 ? "place" : "places"} cut off in Locations` });
  cut.focus();
  await userEvent.keyboard("{Enter}");
  expect(destination().params.get("ids")).toBe(withCut.cutOff.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe(`Cut off if ${withCut.pathway} closes`);

  const longer = screen.getByRole("link", { name: new RegExp(`^${withCut.pathway}: list the \\d+ places with a longer walk in Locations$`) });
  longer.focus();
  await userEvent.keyboard(" ");
  expect(destination().params.get("ids")).toBe(withCut.longerPlaces!.map((place) => place.id).join(","));

  // A detour-only pathway has no cut-off link, only the longer-walk one.
  expect(screen.queryByRole("link", { name: new RegExp(`^${detourOnly.pathway}: list the .* cut off`) })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("link", { name: new RegExp(`^${detourOnly.pathway}: list the \\d+ places with a longer walk`) }), { key: "Enter" });
  expect(destination().params.get("why")).toBe(`Longer walk if ${detourOnly.pathway} closes`);
});

it("opens the places an access type reaches from its count label, even when every routable place is reachable", async () => {
  const base = fixture();
  const reach = base.reach!;
  const full = { ...reach.modes[0], reachable: reach.total, unreachable: [], reachablePlaces: reach.modes[0].reachablePlaces!.concat(reach.modes[0].unreachable) };
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({ ...base, reach: { ...reach, modes: [full, reach.modes[1]] } });
  renderPage();
  await screen.findByText("Reach by access type");

  // Fully reachable: no row-label link for the empty gap, but the reached list is still reachable by keyboard.
  expect(screen.queryByRole("link", { name: /Walking: list the \d+ places it can't reach/ })).not.toBeInTheDocument();
  const reached = screen.getByRole("link", { name: `Walking: list the ${full.reachablePlaces.length} places it reaches` });
  reached.focus();
  await userEvent.keyboard("{Enter}");
  expect(destination().params.get("ids")).toBe(full.reachablePlaces.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe("Reachable by walking");

  const vehicle = reach.modes[1];
  fireEvent.keyDown(screen.getByRole("link", { name: `Vehicle: list the ${vehicle.unreachable.length} places it can't reach` }), { key: " " });
  expect(destination().params.get("why")).toBe("Not reachable by vehicle");
});

it("names the year on all-time search dates where a history spans several years", () => {
  const dates = ["2025-12-22", "2025-12-29", "2026-01-05", "2026-01-12"];
  const labels = dates.map((date, index) => bucketAxisLabel(date, index, dates, "all"));
  expect(labels).toEqual(["Dec 22, 2025", "Dec 29", "Jan 5, 2026", "Jan 12"]);
  expect(bucketTooltipLabel("2025-12-29", "all")).toBe("Week of Dec 29, 2025");
  // A calendar year or a short range already says which year it is.
  expect(bucketAxisLabel("2026-01-05", 0, ["2026-01-05"], "year-2026")).toBe("Jan 5");
  expect(bucketTooltipLabel("2026-01-05", "year-2026")).toBe("Week of Jan 5");
});
