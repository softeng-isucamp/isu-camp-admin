import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { normalizeBackendDecisionAnalytics, services } from "../../services/api";
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

  for (const title of ["Missing details", "Closure impact", "Reach by travel mode", "Search activity", "Searches for destinations without markers"]) {
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
  await userEvent.click(screen.getByRole("heading", { name: "Reach by travel mode" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // Clicking plain content would drop focus to <body>; it goes back to the (i) button instead.
  await waitFor(() => expect(button).toHaveFocus());

  // Clicking another control closes the guide but leaves focus on that control.
  await userEvent.click(button);
  const other = screen.getByRole("button", { name: "How to read Reach by travel mode" });
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

it("opens the reachable and unreachable places from the two parts of a travel mode's bar", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Reach by travel mode");
    const bicycle = fixture().reach!.modes.findIndex((mode) => mode.mode === "Bicycle");
  const mode = fixture().reach!.modes[bicycle];

  fireEvent.click(segments("Reach by travel mode")[0][bicycle]);
  expect(destination().params.get("ids")).toBe(mode.reachablePlaces!.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe("Reachable by bicycle");

  fireEvent.click(segments("Reach by travel mode")[1][bicycle]);
  expect(destination().params.get("ids")).toBe(mode.unreachable.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe("Not reachable by bicycle");
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

it("keeps map pins honest: a footprint-only place has a position, so only places with neither are missing a pin", () => {
  const places = locations.filter((item) => item.type === "Place" && item.status === "Active");
  const footprintOnly = { ...places[0], id: "fp-only", positioned: false, lat: null, lng: null, polygonCoordinates: [[1, 1], [1, 2], [2, 2]] as [number, number][] };
  const neither = { ...places[1], id: "nothing", positioned: false, lat: null, lng: null };
  const pin = generateDecisionAnalytics("week", [...locations, footprintOnly, neither]).readiness.checks.find((check) => check.key === "pin")!;
  // The fixture applies the server's rule: a footprint is a position, so only the place with neither is missing a pin.
  expect(pin.missing.map((place) => place.id)).toContain("nothing");
  expect(pin.missing.map((place) => place.id)).not.toContain("fp-only");
  expect(pin.have!.map((place) => place.id)).toContain("fp-only");
});

it("counts a searched footprint-only place as having a marker and a room under no active building as no destination", () => {
  const places = locations.filter((item) => item.type === "Place" && item.status === "Active");
  const footprintOnly = { ...places[0], id: "fp-only", positioned: false, lat: null, lng: null, polygonCoordinates: [[1, 1], [1, 2], [2, 2]] as [number, number][] };
  const orphanRoom = { ...locations.find((item) => item.type === "Room" && item.status === "Active")!, id: "orphan-room", parentId: "missing-parent" };
  const gap = generateDecisionAnalytics("all", [...locations, footprintOnly, orphanRoom]).searches.markerGap;
  const place = gap.find((row) => row.type === "Building")!;
  expect(place.missing.map((item) => item.id)).not.toContain("fp-only");
  expect(gap.flatMap((row) => [...row.missing, ...row.have]).map((item) => item.id)).not.toContain("orphan-room");
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
  await screen.findByText("Reach by travel mode");

  const reached = segments("Reach by travel mode")[0][0];
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
  await screen.findByText("Reach by travel mode");

  const unreachable = segments("Reach by travel mode")[1][0];
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
  expect(parsed.searches.markerGap).toEqual(fixture().searches.markerGap);
  expect(() => normalizeBackendDecisionAnalytics({ ...fixture(), searches: { ...fixture().searches, activity: { bucket: "month", points: [] } } })).toThrow();
  expect(() => normalizeBackendDecisionAnalytics({ ...fixture(), searches: { ...fixture().searches, markerGap: [{ type: "Floor", searches: 1, withoutMarker: 0, notOnMap: 0, missing: [], have: [] }] } })).toThrow();
});

it("builds a fixture whose searches add up across the time series, the account types and the destination types", () => {
  for (const range of ["week", "month", "all", "year-2026"] as const) {
    const { searches } = generateDecisionAnalytics(range, locations);
    const { points, bucket } = searches.activity;
    expect(bucket).toBe(range === "week" || range === "month" ? "day" : "week");
    expect(points.length).toBe(range === "week" ? 7 : range === "month" ? 30 : points.length);
    expect(points.reduce((sum, point) => sum + point.total, 0)).toBe(searches.total);
    for (const point of points) expect(point.student + point.teacher + point.visitor).toBe(point.total);
    expect(searches.byAccountType.student + searches.byAccountType.teacher + searches.byAccountType.visitor).toBe(searches.total);
    expect(searches.markerGap.map((row) => row.type)).toEqual(["Building", "Room", "Laboratory", "Office", "Restroom"]);
    for (const row of searches.markerGap) {
      expect(row.withoutMarker).toBeLessThanOrEqual(row.searches);
      expect(row.notOnMap).toBeLessThanOrEqual(row.withoutMarker);
      expect(row.missing.reduce((sum, item) => sum + item.searches, 0)).toBe(row.withoutMarker);
      expect(row.missing.reduce((sum, item) => sum + item.searches, 0) + row.have.reduce((sum, item) => sum + item.searches, 0)).toBe(row.searches);
    }
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
    searches: { ...base.searches, total: 0, byAccountType: { student: 0, teacher: 0, visitor: 0 }, activity: { bucket: "day", points: base.searches.activity.points.map((point) => ({ ...point, total: 0, student: 0, teacher: 0, visitor: 0 })) }, markerGap: base.searches.markerGap.map((row) => ({ ...row, searches: 0, withoutMarker: 0, notOnMap: 0, missing: [], have: [] })) },
  });
  renderPage();
  expect(await screen.findByText("No searches were recorded in this range.")).toBeInTheDocument();
  expect(screen.getByText("No searches for active destinations were recorded in this range.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "How to read Search activity" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("not visits, arrivals, unique people or route attempts");
});

/** The marker-gap rows in the order the chart ranks them. */
const rankedGap = () => [...fixture().searches.markerGap].sort((a, b) => b.withoutMarker - a.withoutMarker || b.searches - a.searches);
const gapLabels = { Building: "Places", Room: "Rooms", Laboratory: "Laboratories", Office: "Offices", Restroom: "Restrooms" } as const;

it("shows both the missing-marker count and the total for each destination type, not a percentage alone", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Searches for destinations without markers");
  const block = screen.getByRole("heading", { name: "Searches for destinations without markers" }).closest(".graph") as HTMLElement;
  const text = Array.from(block.querySelectorAll("text")).map((node) => node.textContent);

  // Ranked by missing-marker searches; each row states both counts and the share.
  const expected = rankedGap().map((row) => (row.searches ? `${row.withoutMarker} of ${row.searches} · ${Math.round((row.withoutMarker / row.searches) * 100)}%` : "no searches"));
  expect(text.filter((value) => / of \d+ · \d+%$|^no searches$/.test(value ?? ""))).toEqual(expected);
});

it("opens the searched destinations with no marker from the red part and those with one from the blue part, by typed key", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Searches for destinations without markers");
  const ranked = rankedGap();
  const without = ranked.find((row) => row.missing.length)!;
  const withIt = ranked.find((row) => row.have.length)!;
  expect(without.type).not.toBe("Building");

  fireEvent.click(segments("Searches for destinations without markers")[0][0]);
  expect(destination().path).toBe("/locations");
  expect(destination().params.get("keys")).toBe(without.missing.map((item) => `${without.type}:${item.id}`).join(","));
  expect(destination().params.get("why")).toBe(`${gapLabels[without.type]} searched, no marker`);
  expect(destination().params.get("ids")).toBeNull();

  fireEvent.click(segments("Searches for destinations without markers")[1][0]);
  const prefix = withIt.type === "Building" ? "Place" : withIt.type;
  expect(destination().params.get("keys")).toBe(withIt.have.map((item) => `${prefix}:${item.id}`).join(","));
  expect(destination().params.get("why")).toBe(`${gapLabels[withIt.type]} searched, with a marker`);
});

it("never says an unmarked room cannot be found: the app falls back to its building", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Searches for destinations without markers");
  await userEvent.click(screen.getByRole("button", { name: "How to read Searches for destinations without markers" }));
  const guide = screen.getByRole("dialog");
  expect(guide).toHaveTextContent("still opens an indoor location with no marker at its building");
  expect(guide).toHaveTextContent("only the exact spot is missing");
  expect(guide).toHaveTextContent("not a visit");
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
  const rooms = base.searches.markerGap.find((row) => row.type === "Room")!;
  const mixed = { ...rooms, searches: rooms.searches + 3, have: [{ id: "marked-room", name: "Marked Room", searches: 3 }] };
  vi.spyOn(services.dashboard, "decisionAnalytics").mockResolvedValue({
    ...base,
    searches: { ...base.searches, markerGap: base.searches.markerGap.map((row) => (row.type === "Room" ? mixed : row)) },
  });
  renderPage();
  await screen.findByText("Searches for destinations without markers");

  // A row whose searched places all have markers still has a keyboard link to them.
  const places = base.searches.markerGap.find((row) => row.type === "Building")!;
  expect(places.missing).toHaveLength(0);
  const placesLink = screen.getByRole("link", { name: `Places: list the ${places.have.length} searched places with a marker in Locations` });
  placesLink.focus();
  await userEvent.keyboard("{Enter}");
  expect(destination().params.get("keys")).toBe(places.have.map((item) => `Place:${item.id}`).join(","));

  // A mixed row: the label opens the unmarked ones, the count label the marked ones.
  await userEvent.click(screen.getByRole("link", { name: new RegExp(`^Rooms: list the ${rooms.missing.length} searched rooms with no marker`) }));
  expect(destination().params.get("keys")).toBe(rooms.missing.map((item) => `Room:${item.id}`).join(","));
  fireEvent.click(screen.getByRole("link", { name: "Rooms: list the 1 searched rooms with a marker in Locations" }));
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
