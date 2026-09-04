import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkBrowser } from "./NetworkBrowser";
import type { Pathway, RouteNode } from "../../types";

const nodes: RouteNode[] = [
  { id: "node-library", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: "building-library", lat: 16.72, lng: 121.69, status: "Active" },
  { id: "node-quad", name: "Quad Junction", nodeType: "Junction", lat: 16.721, lng: 121.691, status: "Inactive" },
];
const pathways: Pathway[] = [
  { id: "path-library", name: "Library Walk", sourceNodeId: "node-library", destinationNodeId: "node-quad", distance: "120 m", time: "2 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
  { id: "path-service", name: "Service Link", sourceNodeId: "node-quad", destinationNodeId: "node-library", distance: "90 m", time: "1 min", shade: "Unshaded", type: "Service path", direction: "One-way", status: "Closed", pathPoints: [] },
];

describe("NetworkBrowser", () => {
  afterEach(cleanup);
  it("filters the active entity type with meaningful filters and selects the map object", () => {
    const onSelect = vi.fn();
    render(<NetworkBrowser pathways={pathways} nodes={nodes} buildings={[{ id: "building-library", name: "Library", code: "LIB", points: [] }]} selected={null} onSelect={onSelect} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Pathway results" })).toHaveTextContent("2 Pathways");
    fireEvent.change(screen.getByLabelText("Shade"), { target: { value: "Mostly Shaded" } });
    expect(screen.getByRole("button", { name: /Library Walk/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Service Link/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Library Walk/ }));
    expect(onSelect).toHaveBeenCalledWith({ type: "pathway", id: "path-library" });
  });

  it("keeps all Pathway filters visually available", () => {
    render(<NetworkBrowser pathways={pathways} nodes={nodes} buildings={[]} selected={null} onSelect={vi.fn()} onDismiss={vi.fn()} />);

    for (const label of [
      "Status",
      "Type",
      "Direction",
      "Shade",
    ]) {
      const control = screen.getByLabelText(label);
      expect(control).toBeVisible();
      expect(control.parentElement).toHaveClass("grid");
    }
  });

  it("reflects a map selection in the matching Route Node tab and result", () => {
    render(<NetworkBrowser pathways={pathways} nodes={nodes} buildings={[{ id: "building-library", name: "Library", code: "LIB", points: [] }]} selected={{ type: "node", id: "node-library" }} onSelect={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Route Nodes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Library Entrance/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("places Import Walking Network immediately below Pathways search", () => {
    const onImport = vi.fn();
    render(<NetworkBrowser pathways={pathways} nodes={nodes} buildings={[]} selected={null} onSelect={vi.fn()} onDismiss={vi.fn()} onImportWalkingNetwork={onImport} />);

    const search = screen.getByPlaceholderText("Search Pathways");
    const importButton = screen.getByRole("button", { name: "Import Walking Network" });
    const filters = screen.getByLabelText("Status");

    expect(search.compareDocumentPosition(importButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(importButton.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(importButton);
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
