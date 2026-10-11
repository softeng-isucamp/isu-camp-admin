import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapIssuesTray } from "./MapIssuesTray";
import type { MapIssue } from "./session/mapIssues";

const crossing = (id: string, onClick = vi.fn()): MapIssue => ({
  id,
  kind: "pathway-crossing",
  title: `Crossing ${id}`,
  detail: "Not routable",
  point: [16.72, 121.69],
  selection: null,
  action: { label: `Create Junction & Split Pathway: Crossing ${id}`, shortLabel: "Create Junction", onClick },
});
const noEntrance = (id: string): MapIssue => ({
  id,
  kind: "no-entrance",
  title: `Hall ${id}`,
  detail: "0 entrance nodes",
  point: [16.72, 121.69],
  selection: { type: "building", id },
});
const outside = (id: string): MapIssue => ({
  id,
  kind: "outside-boundary",
  title: `Far ${id}`,
  detail: "Route Node",
  point: [10, 100],
  selection: { type: "node", id },
});

const renderTray = (issues: MapIssue[], activeIssueId: string | null = null, onFocusIssue = vi.fn()) => {
  const view = render(<MapIssuesTray issues={issues} activeIssueId={activeIssueId} onFocusIssue={onFocusIssue} />);
  return { ...view, onFocusIssue };
};
const openTray = () => fireEvent.click(screen.getByRole("button", { name: /^Show map issues/ }));

describe("MapIssuesTray", () => {
  it("renders nothing without issues", () => {
    const { container } = renderTray([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default and shows the issue count on its pill", () => {
    renderTray([crossing("a"), noEntrance("b"), outside("c")]);

    const pill = screen.getByRole("button", { name: "Show map issues (3)" });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill).toHaveTextContent("3 issues");
    expect(screen.queryByText("Crossing a")).not.toBeInTheDocument();
  });

  it("does not open by itself when a new alert appears", () => {
    const { rerender, onFocusIssue } = renderTray([outside("c")]);

    rerender(<MapIssuesTray issues={[outside("c"), crossing("new")]} activeIssueId={null} onFocusIssue={onFocusIssue} />);

    expect(screen.getByRole("button", { name: "Show map issues (2)" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Crossing new")).not.toBeInTheDocument();
  });

  it("groups issues under headers with counts and one explanatory line per group", () => {
    renderTray([crossing("a"), crossing("b"), noEntrance("c"), outside("d")]);
    openTray();

    expect(screen.getByRole("button", { name: "Show map issues (4)" })).toHaveAttribute("aria-expanded", "true");
    const crossings = screen.getByRole("button", { name: /Crossing without junction/ });
    const entrances = screen.getByRole("button", { name: /No entrance/ });
    const boundary = screen.getByRole("button", { name: /Outside campus boundary/ });
    expect(crossings).toHaveTextContent("2");
    expect(entrances).toHaveTextContent("1");
    expect(boundary).toHaveTextContent("1");
    // Alert groups start open, informational ones closed.
    expect(crossings).toHaveAttribute("aria-expanded", "true");
    expect(entrances).toHaveAttribute("aria-expanded", "true");
    expect(boundary).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Routes cannot turn here until a Junction is created.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hall c, 0 entrance nodes" })).toBeInTheDocument();
    expect(screen.getByText("0 entrance nodes")).toBeInTheDocument();
    expect(screen.queryByText("Far d")).not.toBeInTheDocument();
    // Alerts are listed before the informational group.
    expect(crossings.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("collapses and expands a group", () => {
    renderTray([crossing("a"), outside("d")]);
    openTray();

    fireEvent.click(screen.getByRole("button", { name: /Crossing without junction/ }));
    expect(screen.queryByText("Crossing a")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Crossing without junction/ })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: /Outside campus boundary/ }));
    expect(screen.getByText("Far d")).toBeInTheDocument();
  });

  it("opens the group of the active issue even when it is informational", () => {
    renderTray([crossing("a"), outside("d")], "d");
    openTray();

    expect(screen.getByRole("button", { name: /Outside campus boundary/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("focuses an issue when its row is clicked without running its action", () => {
    const action = vi.fn();
    const issue = crossing("a", action);
    const { onFocusIssue } = renderTray([issue]);
    openTray();

    fireEvent.click(screen.getByRole("button", { name: "Crossing a, Not routable" }));

    expect(onFocusIssue).toHaveBeenCalledExactlyOnceWith(issue);
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the fix action without focusing the issue", () => {
    const action = vi.fn();
    const { onFocusIssue } = renderTray([crossing("a", action)]);
    openTray();

    fireEvent.click(screen.getByRole("button", { name: "Create Junction & Split Pathway: Crossing a" }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(onFocusIssue).not.toHaveBeenCalled();
  });

  it("shows the action's short label while keeping its full accessible name", () => {
    renderTray([crossing("a")]);
    openTray();

    expect(screen.getByRole("button", { name: "Create Junction & Split Pathway: Crossing a" })).toHaveTextContent("Create Junction");
  });

  it("gives object rows a compact locate icon and no fix button, and crossing rows their action instead", () => {
    renderTray([crossing("a"), noEntrance("b"), outside("c")], "c");
    openTray();

    const row = (name: string) => screen.getByRole("button", { name }).closest("li") as HTMLElement;
    expect(within(row("Hall b, 0 entrance nodes")).getByRole("img", { name: "Locate" })).toBeInTheDocument();
    expect(within(row("Far c, Route Node")).getByRole("img", { name: "Locate" })).toBeInTheDocument();
    expect(within(row("Hall b, 0 entrance nodes")).getAllByRole("button")).toHaveLength(1);
    expect(within(row("Crossing a, Not routable")).queryByRole("img", { name: "Locate" })).not.toBeInTheDocument();
    expect(within(row("Crossing a, Not routable")).getAllByRole("button")).toHaveLength(2);
  });

  it("marks only the active row and keeps the tray open after focusing", () => {
    const { rerender, onFocusIssue } = renderTray([noEntrance("b"), noEntrance("c")]);
    openTray();
    fireEvent.click(screen.getByRole("button", { name: "Hall c, 0 entrance nodes" }));

    rerender(<MapIssuesTray issues={[noEntrance("b"), noEntrance("c")]} activeIssueId="c" onFocusIssue={onFocusIssue} />);

    expect(screen.getByRole("button", { name: "Hall c, 0 entrance nodes" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Hall b, 0 entrance nodes" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Show map issues (2)" })).toHaveAttribute("aria-expanded", "true");
  });

  it("scrolls the active row into view when the browser supports it", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderTray([noEntrance("b"), noEntrance("c")], "c");
      openTray();

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("closes from its header without losing the pill", () => {
    renderTray([crossing("a")]);
    openTray();

    fireEvent.click(within(screen.getByRole("region", { name: "Map issues" })).getByRole("button", { name: "Close issues tray" }));

    expect(screen.queryByRole("region", { name: "Map issues" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show map issues (1)" })).toHaveAttribute("aria-expanded", "false");
  });
});
