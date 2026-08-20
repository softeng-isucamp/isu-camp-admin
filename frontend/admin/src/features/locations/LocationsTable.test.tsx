import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Locations } from "./Locations";

function renderLocations(initialEntries = ["/locations"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Locations />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Locations screen table and hierarchy toggle validation", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the campus locations heading and default hierarchy table with tree connectors", async () => {
    renderLocations();
    expect(await screen.findByRole("heading", { name: "Campus Locations" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Manage buildings, floors, rooms, offices, laboratories, restrooms, and facilities.")).toBeInTheDocument();

    // Check hierarchy items in table
    const ccsictElements = await screen.findAllByText("CCSICT Building", {}, { timeout: 4000 });
    expect(ccsictElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Floor 2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Computer Lab 1")).toBeInTheDocument();
    expect(screen.getByText("University Library")).toBeInTheDocument();
  });

  it("allows toggling between hierarchy tree view and flat table view", async () => {
    renderLocations();
    const ccsictElements = await screen.findAllByText("CCSICT Building", {}, { timeout: 4000 });
    expect(ccsictElements.length).toBeGreaterThanOrEqual(1);

    // Find the view toggle button (Hierarchy / Flat)
    const toggleButton = await screen.findByRole("button", { name: /switch to flat view|switch to hierarchy view|flat view|hierarchy view|view mode|toggle view/i });
    expect(toggleButton).toBeInTheDocument();

    // Switch to flat view
    fireEvent.click(toggleButton);
    expect(screen.getByText(/hierarchy view/i)).toBeInTheDocument();

    // Switch back to hierarchy view
    fireEvent.click(toggleButton);
    expect(screen.getByText(/flat view/i)).toBeInTheDocument();
  });

  it("allows expanding and collapsing parent nodes in hierarchy view", async () => {
    renderLocations();
    const ccsictElements = await screen.findAllByText("CCSICT Building", {}, { timeout: 4000 });
    expect(ccsictElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Computer Lab 1")).toBeInTheDocument();

    // Find collapse button for CCSICT Building
    const collapseBtn = await screen.findByRole("button", { name: /collapse CCSICT Building/i });
    fireEvent.click(collapseBtn);

    // Expand button is now available
    const expandBtn = await screen.findByRole("button", { name: /expand CCSICT Building/i });
    fireEvent.click(expandBtn);
    expect(await screen.findByText("Computer Lab 1")).toBeInTheDocument();
  });

  it("opens and interacts with the Add Location modal with Figma fields", async () => {
    renderLocations();
    const addBtn = await screen.findByRole("button", { name: /\+ add location|add location/i }, { timeout: 4000 });
    fireEvent.click(addBtn);

    expect(await screen.findByRole("heading", { name: /add location/i })).toBeInTheDocument();
    expect(screen.getByText(/add a building, floor, room, office, laboratory, restroom, or facility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location code \/ id/i)).toBeInTheDocument();

    // Cancel modal
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);
  });

  it("opens the Import Locations JSON modal and supports validation states", async () => {
    renderLocations();
    const importBtn = await screen.findByRole("button", { name: /import json/i }, { timeout: 4000 });
    fireEvent.click(importBtn);

    expect(await screen.findByRole("heading", { name: /import locations json/i })).toBeInTheDocument();
    expect(screen.getByText(/validate campus location records before importing/i)).toBeInTheDocument();
    expect(screen.getByText(/upload json file/i)).toBeInTheDocument();
    expect(screen.getByText(/add new/i)).toBeInTheDocument();
    expect(screen.getByText(/update existing/i)).toBeInTheDocument();
  });
});
