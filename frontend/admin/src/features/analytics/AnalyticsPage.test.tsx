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

it("opens the places with a readiness check from its blue part and those missing it from its red part", async () => {
  vi.spyOn(services.dashboard, "decisionAnalytics").mockImplementation(async () => fixture());
  renderPage();
  await screen.findByText("Directory readiness");
  // Recharts draws no rectangle for an empty part, so the first drawn part belongs to the first check that has one.
  const { checks } = fixture().readiness;
  const withIt = checks.find((check) => check.have?.length)!;
  const without = checks.find((check) => check.missing.length)!;

  fireEvent.click(segments("Directory readiness")[0][0]);
  expect(destination().params.get("ids")).toBe(withIt.have!.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe(`With ${withIt.label.toLowerCase()}`);

  fireEvent.click(segments("Directory readiness")[1][0]);
  expect(destination().params.get("ids")).toBe(without.missing.map((place) => place.id).join(","));
  expect(destination().params.get("why")).toBe(`Missing ${without.label.toLowerCase()}`);
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

it("leaves the reachable and readiness 'with' halves unclickable when the server sends no list, as today's backend does", async () => {
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

  const ready = segments("Directory readiness")[0][0];
  expect(ready).toHaveAttribute("cursor", "default");
  fireEvent.click(ready);
  expect(destination().path).toBe("/");

  // The halves the backend does send still open their places.
  fireEvent.click(segments("Directory readiness")[1][0]);
  expect(destination().path).toBe("/locations");
});

it("keeps the optional place lists for the other half of each bar when the server sends them", () => {
  const parsed = normalizeBackendDecisionAnalytics(fixture());
  expect(parsed.readiness.checks[0].have).toEqual(fixture().readiness.checks[0].have);
  expect(parsed.closures![0].longerPlaces).toEqual(fixture().closures![0].longerPlaces);
  expect(parsed.reach!.modes[0].reachablePlaces).toEqual(fixture().reach!.modes[0].reachablePlaces);
});
