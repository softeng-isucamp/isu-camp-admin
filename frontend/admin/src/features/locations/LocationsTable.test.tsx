import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Locations } from "./Locations";
import { services, setMockFailure } from "../../services/api";
import { PasswordConfirmationRequiredError } from "../../services/errors";
import { chooseFilterOption, filterOptionIds, filterOptionNames, selectedFilterOptionId } from "../../test/filterCombobox";

function LocationRouteProbe() {
  const location = useLocation();
  return <output data-testid="location-route">{location.pathname}{location.search}</output>;
}

function renderLocations(initialEntries: Array<string | { pathname: string; search?: string; state?: unknown }> = ["/locations"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Locations />
        <LocationRouteProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...rendered, queryClient };
}

/** Deletes are re-authenticated: fill the open dialog's password prompt. */
function confirmDeletePassword(password = "password123") {
  fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: password } });
}

/** Drives the parent-Building type-ahead: focus, type, then pick the listed match. */
function chooseParentBuilding(name: string) {
  const combobox = screen.getByLabelText("PARENT BUILDING");
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: name } });
  // Several Buildings can contain the typed text, so match the option's name exactly.
  const option = within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .find((candidate) => candidate.querySelector(".parent-building-option-name")?.textContent === name);
  if (!option) throw new Error(`No parent Building option named "${name}" is listed.`);
  fireEvent.click(option);
}

/** Drives the BUILDING filter combobox: open it, optionally type, then pick the option by exact name. */
function chooseFilterBuilding(name: string, search = name) {
  const combobox = screen.getByLabelText("BUILDING");
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: search } });
  const option = within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .find((candidate) => candidate.querySelector(".parent-building-option-name")?.textContent === name);
  if (!option) throw new Error(`No BUILDING filter option named "${name}" is listed.`);
  fireEvent.click(option);
}

describe("Locations screen table and hierarchy toggle validation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the campus locations heading and default hierarchy table with tree connectors", async () => {
    renderLocations();
    expect(await screen.findByRole("heading", { name: "Campus Locations" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Manage Buildings and Indoor Locations. Create mapped campus places in Map Editor.")).toBeInTheDocument();

    // Check items in table
    const administrationBuildingMatches = await screen.findAllByText("Administration Building", {}, { timeout: 4000 });
    expect(administrationBuildingMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Science Building").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("SB Classroom").length).toBeGreaterThanOrEqual(1);
  });

  it("allows toggling between hierarchy tree view and flat table view", async () => {
    renderLocations();
    const administrationBuildingMatches = await screen.findAllByText("Administration Building", {}, { timeout: 4000 });
    expect(administrationBuildingMatches.length).toBeGreaterThanOrEqual(1);

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

  it("uses ten rows in both views without communicating placement through the icon", async () => {
    const { container } = renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    expect(container.querySelectorAll(".location-type-symbol").length).toBeGreaterThan(0);
    expect(container.querySelector(".location-type-symbol")).toHaveStyle({ background: "#f3f4f6", opacity: "1" });
    expect(screen.queryByLabelText("Positioned location")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unpositioned location")).not.toBeInTheDocument();
    expect(screen.queryByText("Not positioned")).not.toBeInTheDocument();
    expect(screen.queryByText("Positioned")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /toggle view mode/i }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("keeps derived Floor Levels available without exposing Floor as a record filter", async () => {
    renderLocations();
    await screen.findByLabelText("TYPE");
    expect(filterOptionNames("TYPE")).not.toContain("Floor");
    expect(filterOptionNames("FLOOR")).toContain("Ground Floor");
  });

  it("renders Floor Levels as grouping rows without location metadata", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: "Expand Administration Building" }));
    const floorRow = (await screen.findAllByRole("row"))
      .find((row) => row.querySelector("strong")?.textContent === "Ground Floor");

    expect(floorRow).toBeDefined();
    expect(floorRow).toHaveTextContent("Ground Floor");
    expect(floorRow).not.toHaveTextContent("Active");
    expect(floorRow).not.toHaveTextContent("BLD-ADM-01-Ground Floor");
    expect(floorRow?.querySelectorAll("td")).toHaveLength(1);
    expect(floorRow?.querySelector("td")).toHaveAttribute("colspan", "5");
  });

  it("keeps flat-view pagination record-based and resets to page one after filtering", async () => {
    const { container } = renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    fireEvent.click(screen.getByRole("button", { name: /toggle view mode/i }));
    expect(await screen.findByText(/Showing 1–10 of/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByText(/Showing 11–20 of/i)).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    chooseFilterOption("TYPE", "College");
    expect(await screen.findByText(/Showing 1–10 of/i)).toBeInTheDocument();
  });

  it("paginates hierarchy families atomically across the old page boundary", async () => {
    for (let index = 1; index <= 11; index += 1) {
      const buildingId = `pagination-family-building-${index}`;
      await services.locations.save({
        id: buildingId,
        name: `Pagination Family ${index}`,
        code: `PAG-${index}`,
        type: "Place", classification: "College",
        parentId: null,
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      });
      await services.locations.save({
        id: `pagination-family-room-${index}`,
        name: `Pagination Family Room ${index}`,
        code: `PAG-ROOM-${index}`,
        type: "Room",
        parentId: buildingId,
        building: `Pagination Family ${index}`,
        floor: "Ground Floor",
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      });
    }

    const { container } = renderLocations(["/locations?q=Pagination%20Family"]);
    expect(await screen.findByText("Pagination Family Room 10", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–10 of 11/)).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(10);

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("Pagination Family 11")).toBeInTheDocument();
    expect(screen.getAllByText("Pagination Family Room 11").length).toBeGreaterThan(0);
    expect(screen.queryByRole("row", { name: /Pagination Family Room 10/ })).not.toBeInTheDocument();
  });

  it("uses building IDs to isolate duplicate building names", async () => {
    await services.locations.save({ id: "duplicate-building-a", name: "Duplicate Building", code: "DUP-A", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-building-b", name: "Duplicate Building", code: "DUP-B", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-room-a", name: "Room in duplicate A", code: "DUP-ROOM-A", type: "Room", parentId: "duplicate-building-a", building: "Duplicate Building", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-room-b", name: "Room in duplicate B", code: "DUP-ROOM-B", type: "Room", parentId: "duplicate-building-b", building: "Duplicate Building", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();
    const buildingCombobox = await screen.findByLabelText("BUILDING");
    fireEvent.focus(buildingCombobox);
    fireEvent.change(buildingCombobox, { target: { value: "Duplicate Building" } });
    const duplicateOptions = within(screen.getByRole("listbox")).getAllByRole("option").filter((option) => option.textContent?.startsWith("Duplicate Building"));
    expect(duplicateOptions.map((option) => option.querySelector(".parent-building-option-code")?.textContent)).toEqual(["DUP-A", "DUP-B"]);

    fireEvent.click(duplicateOptions[1]);
    expect(await screen.findByText("Room in duplicate B")).toBeInTheDocument();
    expect(screen.queryByText("Room in duplicate A")).not.toBeInTheDocument();
  });

  it("resets stale Building and Floor selections after the selected Building is deleted", async () => {
    const building = await services.locations.save({ id: "stale-filter-building", name: "Stale Filter Building", code: "STALE-BLDG", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "stale-filter-room", name: "Stale Filter Room", code: "STALE-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();
    const buildingCombobox = await screen.findByLabelText("BUILDING");
    const floorSelect = screen.getByLabelText("FLOOR");
    await waitFor(() => chooseFilterBuilding(building.name));
    await waitFor(() => expect(filterOptionNames("FLOOR").length).toBeGreaterThan(1));
    chooseFilterOption("FLOOR", "Ground Floor");
    expect(selectedFilterOptionId("FLOOR")).toBe(`${building.id}-floor-Ground Floor`);

    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(buildingCombobox).toHaveValue("All Buildings");
      expect(floorSelect).toHaveTextContent("All Floors");
    });
    expect(selectedFilterOptionId("FLOOR")).toBeUndefined();
  });

  it("returns to the last hierarchy page after a mutation shrinks the result", async () => {
    for (let index = 1; index <= 11; index += 1) {
      await services.locations.save({ id: `shrink-page-building-${index}`, name: `Shrink Page ${index}`, code: `SHRINK-${index}`, type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    }
    renderLocations(["/locations?q=Shrink%20Page"]);
    expect(await screen.findByText("Shrink Page 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByRole("row", { name: /Shrink Page 11/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Shrink Page 11" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–10 of 10/)).toBeInTheDocument();
      expect(Array.from(document.querySelectorAll("tbody tr")).some((row) => row.querySelector("strong")?.textContent === "Shrink Page 1")).toBe(true);
      expect(screen.queryByRole("row", { name: /Shrink Page 11/ })).not.toBeInTheDocument();
    });
  });

  it("does not attach a normal child with a duplicate legacy building name to both roots", async () => {
    await services.locations.save({ id: "legacy-name-building-a", name: "Same Name Root", code: "SAME-A", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "legacy-name-building-b", name: "Same Name Root", code: "SAME-B", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "authoritative-child", name: "Authoritative Child", code: "AUTH-CHILD", type: "Room", parentId: "legacy-name-building-b", building: "Same Name Root", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations(["/locations?q=Authoritative%20Child"]);
    expect(await screen.findByText("Authoritative Child")).toBeInTheDocument();
    expect(screen.getAllByRole("row", { name: /Same Name Root/ })).toHaveLength(1);
  });

  it.each(["Building%3A", "Facility%3A", "Place%3A"])("opens an old %s deep link at the matching Place", async (prefix) => {
    const records = [
      { id: "deep-1", name: "Deep Linked Hall", code: "DEEP-1", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
      { id: "deep-2", name: "Other Hall", code: "DEEP-2", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
    ];
    vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });

    renderLocations([`/locations?locationKey=${prefix}deep-1`]);
    expect(await screen.findByRole("row", { name: /Deep Linked Hall/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Other Hall/ })).not.toBeInTheDocument();
  });

  it("renders an orphaned duplicate-name record as an ungrouped row", async () => {
    const records = [
      { id: "orphan-building-a", name: "Orphan Duplicate Building", code: "ORPHAN-A", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
      { id: "orphan-building-b", name: "Orphan Duplicate Building", code: "ORPHAN-B", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
      { id: "orphan-room", name: "Orphan Room", code: "ORPHAN-ROOM", type: "Room" as const, parentId: null, building: "Orphan Duplicate Building", floor: "Ground Floor", status: "Active" as const, lat: null, lng: null, positioned: false },
    ];
    vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });

    renderLocations(["/locations?q=Orphan%20Room"]);
    const orphanRow = await screen.findByRole("row", { name: /Orphan Room/ });
    expect(orphanRow).toHaveTextContent("Orphan Room");
    expect(screen.queryAllByRole("row", { name: /Orphan Duplicate Building/ })).toHaveLength(0);
  });

  it("filters same-named floors by their distinct record IDs", async () => {
    const seed = async (id: string, name: string, type: "Place" | "Floor" | "Room", parentId: string | null) => services.locations.save({ id, name, code: id.toUpperCase(), ...(type === "Place" ? { type: "Place" as const, classification: "College" as const } : { type }), parentId, status: "Active", lat: null, lng: null, positioned: false });
    await seed("floor-building-a", "Floor building A", "Place", null);
    await seed("floor-building-b", "Floor building B", "Place", null);
    await seed("floor-a", "Level One", "Floor", "floor-building-a");
    await seed("floor-b", "Level One", "Floor", "floor-building-b");
    await services.locations.save({ id: "floor-child-a", name: "Only floor A child", code: "FLOOR-CHILD-A", type: "Room", parentId: "floor-building-a", building: "Floor building A", floor: "Level One", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "floor-child-b", name: "Only floor B child", code: "FLOOR-CHILD-B", type: "Room", parentId: "floor-building-b", building: "Floor building B", floor: "Level One", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    await screen.findByLabelText("BUILDING");
    chooseFilterBuilding("Floor building A");
    // Only the chosen Building's own floor record is listed, not building B's same-named one.
    expect(filterOptionIds("FLOOR")).toContain("floor-a");
    expect(filterOptionIds("FLOOR")).not.toContain("floor-b");
    chooseFilterOption("FLOOR", "Level One");
    expect(selectedFilterOptionId("FLOOR")).toBe("floor-a");
    expect(await screen.findByText("Only floor A child")).toBeInTheDocument();
    expect(screen.queryByText("Only floor B child")).not.toBeInTheDocument();
  });

  it("lists each floor name once across all Buildings and matches it in every Building", async () => {
    const seed = (id: string, name: string, parentId: string | null, floor?: string) => services.locations.save({ id, name, code: id.toUpperCase(), ...(parentId ? { type: "Room" as const, floor } : { type: "Place" as const, classification: "College" as const }), parentId, status: "Active", lat: null, lng: null, positioned: false });
    await seed("dedupe-building-a", "Dedupe building A", null);
    await seed("dedupe-building-b", "Dedupe building B", null);
    await seed("dedupe-room-a", "Dedupe room A", "dedupe-building-a", "Ground Floor");
    await seed("dedupe-room-b", "Dedupe room B", "dedupe-building-b", "Ground Floor");
    // The search keeps both rooms on the first page of the shared fixture directory.
    renderLocations(["/locations?q=Dedupe"]);
    await screen.findByLabelText("FLOOR");
    await waitFor(() => expect(filterOptionNames("FLOOR").length).toBeGreaterThan(1));
    const texts = filterOptionNames("FLOOR");
    expect(texts.filter((text) => text === "Ground Floor")).toHaveLength(1);
    expect(new Set(texts).size).toBe(texts.length);

    chooseFilterOption("FLOOR", "Ground Floor");
    expect(await screen.findByText("Dedupe room A")).toBeInTheDocument();
    expect(screen.getByText("Dedupe room B")).toBeInTheDocument();
  });

  it("keeps the selected Place itself in the results when filtering by Building", async () => {
    await services.locations.save({ id: "self-filter-college", name: "Self Filter College", code: "SELF-COL", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "self-filter-room", name: "Self Filter Room", code: "SELF-ROOM", type: "Room", parentId: "self-filter-college", building: "Self Filter College", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByText("Switch to Flat View"));
    await screen.findByLabelText("BUILDING");
    chooseFilterBuilding("Self Filter College");
    expect(await screen.findByText("Self Filter Room")).toBeInTheDocument();
    expect(screen.getAllByText("Self Filter College").length).toBeGreaterThan(0);
    expect(screen.getByRole("row", { name: /Self Filter College/ })).toBeInTheDocument();
  });

  it("keeps only matching indoor locations while retaining building and floor context in search", async () => {
    renderLocations(["/locations?q=Laboratory%20107"]);

    await screen.findByText("Administration Building 2nd Floor Laboratory 107");
    // The retained Building row and the matching Laboratory's row.
    expect((await screen.findAllByRole("row", { name: /Administration Building/ })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText("2nd Floor")).length).toBeGreaterThan(0);
    expect(screen.getByText("Administration Building 2nd Floor Laboratory 107")).toBeInTheDocument();
    expect(screen.getByText("1 locations")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Administration Building Ground Floor Room 101")).not.toBeInTheDocument());
  });

  it("omits empty compatibility Floor Levels from a filtered hierarchy family", async () => {
    await services.locations.save({
      id: "filtered-empty-floor",
      name: "Filtered Empty Floor",
      code: "FILTERED-EMPTY-FLOOR",
      type: "Floor",
      parentId: "osm-location-c5fb7a267a8ca63d",
      building: "Administration Building",
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    });

    renderLocations(["/locations?q=Laboratory%20107"]);

    expect(await screen.findByText("Administration Building 2nd Floor Laboratory 107")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("row", { name: /Filtered Empty Floor/ })).not.toBeInTheDocument());
  });

  it("uses the same neutral symbol treatment for an unpositioned location", async () => {
    await services.locations.save({ id: "unpositioned-icon-test", name: "Unpositioned icon test", code: "ICON-TEST", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations(["/locations?q=Unpositioned%20icon%20test"]);
    const row = await screen.findByRole("row", { name: /Unpositioned icon test/ });
    const icon = row.querySelector(".location-type-symbol");
    expect(icon).toHaveStyle({ background: "#f3f4f6", opacity: "1" });
    expect(icon).not.toHaveStyle({ filter: "grayscale(1)" });
    expect(icon?.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(screen.queryByText("Not positioned")).not.toBeInTheDocument();
  });

  it("allows expanding and collapsing parent nodes in hierarchy view", async () => {
    await services.locations.save({
      id: "adm-flr-2",
      name: "Administration Floor 2",
      code: "FLR-ADM-02",
      type: "Floor",
      parentId: "osm-location-c5fb7a267a8ca63d",
      building: "Administration Building",
      status: "Active",
      lat: 16.72094,
      lng: 121.68965,
      positioned: true,
    });

    const { container } = renderLocations();
    const tableBody = () => within(container.querySelector("tbody") as HTMLElement);
    // Parents start collapsed; expand, then collapse again.
    fireEvent.click(await screen.findByRole("button", { name: /expand Administration Building/i }));
    expect((await tableBody().findAllByText("Administration Floor 2")).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(await screen.findByRole("button", { name: /collapse Administration Building/i }));
    await waitFor(() => expect(tableBody().queryByText("Administration Floor 2")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: /expand Administration Building/i }));
    expect((await tableBody().findAllByText("Administration Floor 2")).length).toBeGreaterThanOrEqual(1);
  });

  it("does not render a KEYWORDS column", async () => {
    renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    await screen.findAllByText("Administration Building");
    expect(screen.queryByRole("columnheader", { name: "KEYWORDS" })).not.toBeInTheDocument();
  });

  it("starts buildings and floors with nested locations collapsed until expanded", async () => {
    const { container } = renderLocations();
    const expandBuilding = await screen.findByRole("button", { name: "Expand Administration Building" });
    const tableBody = () => within(container.querySelector("tbody") as HTMLElement);
    expect(tableBody().queryByText("2nd Floor")).not.toBeInTheDocument();
    expect(screen.queryByText("Administration Building 2nd Floor Laboratory 107")).not.toBeInTheDocument();
    fireEvent.click(expandBuilding);
    fireEvent.click(await screen.findByRole("button", { name: "Expand 2nd Floor" }));
    expect(await tableBody().findByText("Administration Building 2nd Floor Laboratory 107")).toBeInTheDocument();
  });

  it("keeps collapsed nested locations out of the top-level rows", async () => {
    renderLocations();
    await screen.findByRole("button", { name: "Expand Administration Building" });
    const collapsedTotal = screen.getByText(/Showing 1–10 of \d+/).textContent;
    fireEvent.click(screen.getByRole("button", { name: "Expand Administration Building" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand 2nd Floor" }));
    await screen.findByRole("button", { name: "Collapse 2nd Floor" });
    expect(screen.getByText(/Showing 1–10 of \d+/).textContent).toBe(collapsedTotal);
  });

  it("expands nested matches by default when searching", async () => {
    const building = await services.locations.save({ id: "search-building", name: "Search Building", code: "SRCH-B", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "search-room", name: "Searchable Nested Room", code: "SRCH-R", type: "Room", parentId: building.id, building: building.name, floor: "Search Floor", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    expect(screen.queryByText("Searchable Nested Room")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Searchable Nested Room" } });
    expect(await screen.findByText("Searchable Nested Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Search Building" })).toBeInTheDocument();
  });

  it("opens and interacts with the Add Location modal with Figma fields", async () => {
    renderLocations();
    const addLocationButton = await screen.findByRole("button", { name: /\+ add location|add location/i }, { timeout: 4000 });
    fireEvent.click(addLocationButton);

    expect(await screen.findByRole("heading", { name: /add location/i })).toBeInTheDocument();
    expect(screen.getByText(/add a room, office, laboratory, or restroom under an existing building/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location type/i)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location code \/ id/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Pick on map" })).toBeInTheDocument();

    // Cancel modal
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);
  });

  it("shows passive Map Editor guidance and no outdoor choices when adding", async () => {
    renderLocations();
    expect(await screen.findByText("Manage Buildings and Indoor Locations. Create mapped campus places in Map Editor.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Prototype variants" })).not.toBeInTheDocument();
    expect(screen.queryByText("Outdoor records are created in Map Editor.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Create Buildings|Outdoor Point Locations in Map Editor/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Building in Map Editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Outdoor Point Location in Map Editor" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
    const options = Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.value);
    expect(options).toEqual(["Laboratory", "Room", "Office", "Restroom"]);
    expect(screen.queryByLabelText("LATITUDE (OPTIONAL)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("LONGITUDE (OPTIONAL)")).not.toBeInTheDocument();
  });

  it("opens an indoor-location handoff with the Building parent locked and floor preselected", async () => {
    const building = await services.locations.save({
      id: "handoff-building",
      name: "Handoff Building",
      code: "HANDOFF",
      type: "Place", classification: "College",
      parentId: null,
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    });

    renderLocations([`/locations?add=indoor&parentId=${building.id}&floor=${encodeURIComponent("2nd Floor")}`]);

    const dialog = await screen.findByRole("dialog", { name: "Add Location" });
    expect(screen.getByLabelText(/location type/i)).toHaveValue("Room");
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(building.name);
    expect(screen.getByLabelText("PARENT BUILDING")).toBeDisabled();
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("2nd Floor");
    expect(screen.getByLabelText("FLOOR LEVEL")).toBeRequired();
    expect(dialog).toHaveTextContent("locked to preserve that context");
  });

  it("opens an indoor-location handoff for a newly created Building before directory refresh", async () => {
    const pendingBuilding = {
      id: "pending-map-building",
      name: "Pending Map Building",
      code: "PENDING-MAP",
      type: "Place" as const, classification: "College" as const,
      parentId: null,
      status: "Active" as const,
      lat: null,
      lng: null,
      positioned: true,
    };

    renderLocations([{
      pathname: "/locations",
      search: "?add=indoor&parentId=pending-map-building&floor=Ground%20Floor",
      state: { indoorLocationParent: pendingBuilding },
    }]);

    const dialog = await screen.findByRole("dialog", { name: "Add Location" });
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(pendingBuilding.name);
    expect(screen.getByLabelText("PARENT BUILDING")).toBeDisabled();
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("Ground Floor");
    expect(dialog).toHaveTextContent("Pending Map Building");
    expect(screen.queryByText("The selected Building is unavailable for an Indoor Location handoff.")).not.toBeInTheDocument();
  });


  it("creates a child location with a parent building and standard floor level", async () => {
    const building = await services.locations.save({ id: "hierarchy-test-building", name: "Hierarchy Test Building", code: "HIER-BLDG", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    expect(Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "Laboratory", "Room", "Office", "Restroom",
    ]);
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });
    const parentBuilding = screen.getByLabelText("PARENT BUILDING");
    const floorLevel = screen.getByLabelText("FLOOR LEVEL");
    expect(parentBuilding).toHaveValue("");
    fireEvent.focus(parentBuilding);
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: new RegExp(building.name) })).toBeInTheDocument();
    fireEvent.keyDown(parentBuilding, { key: "Escape" });
    // Every floor a user can actually pick. "1st Floor" is gone because it
    // and "Ground Floor" named the same storey, and the empty option is a
    // placeholder rather than a choice, so neither appears here.
    expect(Array.from((floorLevel as HTMLSelectElement).options)
      .filter((option) => !option.disabled)
      .map((option) => option.text)).toEqual([
      "Ground Floor",
      "2nd Floor",
      "3rd Floor",
      "4th Floor",
      "5th Floor",
      "Basement",
    ]);
    const placeholder = Array.from((floorLevel as HTMLSelectElement).options).find((option) => option.value === "");
    expect(placeholder?.disabled).toBe(true);
    expect(placeholder?.hidden).toBe(true);
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: "Hierarchy Test Room" } });
    fireEvent.change(screen.getByLabelText(/location code/i), { target: { value: "HIER-ROOM" } });
    chooseParentBuilding(building.name);
    fireEvent.change(floorLevel, { target: { value: "2nd Floor" } });
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));
    await screen.findByText(/added successfully/i);
    const room = (await services.locations.list("Hierarchy Test Room")).items[0];
    expect(room).toEqual(expect.objectContaining({
      type: "Room",
      parentId: building.id,
      building: building.name,
      floor: "2nd Floor",
      lat: null,
      lng: null,
      positioned: false,
    }));

    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Hierarchy Test Room" } });
    expect((await screen.findAllByText("Hierarchy Test Room")).length).toBeGreaterThan(0);
  });

  it("lists the matching parent Buildings while the name or code is typed", async () => {
    const searched = await services.locations.save({ id: "search-parent-a", name: "Searchable Annex", code: "SRCH-ANX", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const other = await services.locations.save({ id: "search-parent-b", name: "Unrelated Pavilion", code: "UNREL-PAV", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });

    const combobox = screen.getByLabelText("PARENT BUILDING");
    const listed = () => within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent ?? "");

    // Focus alone lists every Building, standalone first.
    fireEvent.focus(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(listed()[0]).toContain("None / Standalone");
    expect(listed().some((option) => option.includes(searched.name))).toBe(true);
    expect(listed().some((option) => option.includes(other.name))).toBe(true);

    // Typing a name narrows the list as it goes.
    fireEvent.change(combobox, { target: { value: "Searchable" } });
    expect(listed().some((option) => option.includes(searched.name))).toBe(true);
    expect(listed().some((option) => option.includes(other.name))).toBe(false);
    expect(screen.getByText(/1 of \d+ buildings match/)).toBeInTheDocument();

    // A code matches the same record.
    fireEvent.change(combobox, { target: { value: "srch-anx" } });
    expect(listed().some((option) => option.includes(searched.name))).toBe(true);
    expect(listed().some((option) => option.includes(other.name))).toBe(false);

    fireEvent.change(combobox, { target: { value: "no such building" } });
    expect(screen.getByText(/No buildings match/)).toBeInTheDocument();

    // Picking a listed match closes the list and shows the chosen Building.
    fireEvent.change(combobox, { target: { value: "Searchable" } });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: new RegExp(searched.name) }));
    expect(combobox).toHaveValue(searched.name);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // The chosen Building can be cleared back to standalone.
    fireEvent.click(screen.getByRole("button", { name: "Clear parent building" }));
    expect(combobox).toHaveValue("");
  });

  it("lists only Places that can contain Locations as parents", async () => {
    for (const [id, classification] of [["pp-college", "College"], ["pp-services", "Campus Services"], ["pp-food", "Food"], ["pp-parking", "Parking"], ["pp-facility", "Facility"]] as const) {
      await services.locations.save({ id, name: `Pick ${classification}`, code: id.toUpperCase(), type: "Place", classification, parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    }
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });
    const combobox = screen.getByLabelText("PARENT BUILDING");
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "Pick " } });

    const listed = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent ?? "");
    for (const name of ["Pick College", "Pick Campus Services"]) expect(listed.some((option) => option.includes(name))).toBe(true);
    for (const name of ["Pick Food", "Pick Parking", "Pick Facility"]) expect(listed.some((option) => option.includes(name))).toBe(false);
  });

  it("chooses a parent Building from the keyboard without submitting the dialog", async () => {
    const building = await services.locations.save({ id: "keyboard-parent", name: "Keyboard Hall", code: "KBD-H", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });

    const combobox = screen.getByLabelText("PARENT BUILDING");
    fireEvent.change(combobox, { target: { value: "Keyboard Hall" } });
    // The first entry is standalone, so one step down lands on the match.
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.keyDown(combobox, { key: "Enter" });

    expect(combobox).toHaveValue(building.name);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Enter chose an option; it must not have saved the half-filled form.
    expect(screen.getByRole("dialog", { name: "Add Location" })).toBeInTheDocument();

    // Escape dismisses the open list without closing the dialog behind it.
    fireEvent.focus(combobox);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add Location" })).toBeInTheDocument();
    expect(combobox).toHaveValue(building.name);
  });

  it("offers no parent Building search when the Building is locked by a quick-add handoff", async () => {
    const building = { id: "locked-search-building", name: "Locked Search Building", code: "LCK-B", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false };
    await services.locations.save(building);
    renderLocations([{ pathname: "/locations", search: "?add=indoor&parentId=locked-search-building", state: { indoorLocationParent: building } }]);
    const combobox = await screen.findByLabelText("PARENT BUILDING");
    expect(combobox).toBeDisabled();
    fireEvent.focus(combobox);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("populates the parent building and floor level when editing a child location", async () => {
    const building = await services.locations.save({ id: "edit-child-building", name: "Edit Child Building", code: "EDIT-BLDG", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-child-room", name: "Edit Child Room", code: "EDIT-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Basement", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Child Room" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Child Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(building.name);
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("Basement");
  });

  it("keeps Pick on map labelled and disabled while indoor metadata is saving", async () => {
    const building = { id: "saving-building", name: "Saving Building", code: "SAVE-B", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false };
    const room = { id: "saving-room", name: "Saving Room", code: "SAVE-R", type: "Room" as const, parentId: building.id, building: building.name, floor: "Ground Floor", function: "Classroom", status: "Active" as const, lat: null, lng: null, positioned: false };
    vi.spyOn(services.locations, "list").mockResolvedValue({ items: [building, room], total: 2, page: 1, pageSize: 50 });
    let completeSave!: () => void;
    const saveLocation = vi.spyOn(services.locations, "save").mockImplementation(() => new Promise((resolve) => {
      completeSave = () => resolve(room);
    }));
    renderLocations();
    fireEvent.change(await screen.findByLabelText(/search locations/i), { target: { value: room.name } });
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${room.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(saveLocation).toHaveBeenCalled());
    try {
      expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Saving…" }).querySelector(".spinner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pick on map" })).toBeDisabled();
    } finally {
      completeSave();
    }
    await screen.findByText(/updated successfully/i);
  });

  it("opens Map Editor directly from an existing indoor location without saving its modal draft", async () => {
    const building = { id: "fast-pick-building", name: "Fast Pick Building", code: "FP-B", type: "Place" as const, classification: "College" as const, parentId: null, status: "Active" as const, lat: 16.721, lng: 121.68965, positioned: true };
    const room = { id: "fast-pick-room", name: "Fast Pick Room", code: "FP-R", type: "Room" as const, parentId: building.id, building: building.name, floor: "Ground Floor", function: "Classroom", keywords: "class", status: "Active" as const, lat: 16.721, lng: 121.68965, positioned: true };
    const page = { items: [building, room], total: 2, page: 1, pageSize: 50 };
    vi.spyOn(services.locations, "list").mockResolvedValue(page);
    const saveLocation = vi.spyOn(services.locations, "save").mockResolvedValue(room);
    const { queryClient } = renderLocations();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.change(await screen.findByLabelText(/search locations/i), { target: { value: room!.name } });
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${room!.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    const coordinates = screen.getByRole("region", { name: "Map coordinates" });
    fireEvent.click(within(coordinates).getByRole("button", { name: "Pick on map" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Location" })).not.toBeInTheDocument());
    expect(screen.getByTestId("location-route")).toHaveTextContent(`/map-editor?indoorLocation=${room.id}&place=1`);
    expect(saveLocation).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("offers the five classifications, never Building, when editing a Place, and keeps indoor types separate", async () => {
    const building = await services.locations.save({ id: "edit-type-building", name: "Edit Type Building", code: "EDIT-TYPE-BLDG", type: "Place", classification: "College", parentId: null, function: "Academic building", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-type-room", name: "Edit Type Room", code: "EDIT-TYPE-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-type-facility", name: "Edit Type Facility", code: "EDIT-TYPE-FACILITY", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();

    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: building.name } });
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    const typeSelect = screen.getByLabelText(/location type/i) as HTMLSelectElement;
    expect(Array.from(typeSelect.options).map((option) => option.text)).toEqual([
      "College", "Campus Services", "Food", "Parking", "Facility",
    ]);
    expect(typeSelect).toHaveValue("College");
    expect(screen.getByLabelText("Latitude")).toHaveValue("Not positioned");

    // It holds an indoor Location, so the classifications that cannot contain one are disabled.
    expect(Array.from(typeSelect.options).filter((option) => option.disabled).map((option) => option.text)).toEqual(["Food", "Parking", "Facility"]);
    expect(screen.getByText("Move or delete its 1 indoor Location before classifying it as Food, Parking, or Facility.")).toBeInTheDocument();

    // A legacy record can be saved unchanged, and moved between containers.
    fireEvent.change(typeSelect, { target: { value: "Campus Services" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    expect(await screen.findByText("Location updated")).toBeInTheDocument();
    const updatedBuilding = (await services.locations.list(building.name)).items.find((item) => item.id === building.id);
    expect(updatedBuilding?.classification).toBe("Campus Services");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Type Room" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Type Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    const indoorTypeOptions = Array.from((await screen.findByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text);
    expect(indoorTypeOptions).toEqual(["Laboratory", "Room", "Office", "Restroom"]);
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Type Facility" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Type Facility" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    // With no indoor Locations a Place can move to any classification.
    expect(await screen.findByLabelText(/location type/i)).toHaveValue("Facility");
    const facilityOptions = Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options);
    expect(facilityOptions.map((option) => option.text)).toEqual(["College", "Campus Services", "Food", "Parking", "Facility"]);
    expect(facilityOptions.some((option) => option.disabled)).toBe(false);
  });

  it("refuses a forbidden classification for a Place with indoor Locations without saving, but allows it with only an empty Floor", async () => {
    const withRoom = await services.locations.save({ id: "refuse-place", name: "Refuse Place", code: "REFUSE-P", type: "Place", classification: "College", parentId: null, function: "Hall", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "refuse-room", name: "Refuse Room", code: "REFUSE-R", type: "Room", parentId: withRoom.id, building: withRoom.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    const floorOnly = await services.locations.save({ id: "floor-only-place", name: "Floor Only Place", code: "FLOOR-P", type: "Place", classification: "College", parentId: null, function: "Hall", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "floor-only-floor", name: "Ground Floor", code: "FLOOR-F", type: "Floor", parentId: floorOnly.id, building: floorOnly.name, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();

    const openEdit = async (name: string) => {
      fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: name } });
      fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
      await screen.findByRole("heading", { name: "Edit Location" });
    };

    await openEdit(withRoom.name);
    const save = vi.spyOn(services.locations, "save");
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Parking" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(screen.getByLabelText(/location type/i)).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("select-location-type-error")).toHaveTextContent("Move or delete its 1 indoor Location before classifying it as Food, Parking, or Facility.");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await openEdit(floorOnly.name);
    const options = Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options);
    expect(options.some((option) => option.disabled)).toBe(false);
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Parking" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("shows a backend error on the classification field", async () => {
    const place = await services.locations.save({ id: "type-error-place", name: "Type Error Place", code: "TYPE-ERR", type: "Place", classification: "Facility", parentId: null, function: "Open area", status: "Active", lat: null, lng: null, positioned: false });
    const refusal = Object.assign(new Error("Invalid type."), { fieldErrors: { type: "Classification is not allowed." } });
    renderLocations();
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: place.name } });
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${place.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    await screen.findByRole("heading", { name: "Edit Location" });

    vi.spyOn(services.locations, "save").mockRejectedValueOnce(refusal);
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    await waitFor(() => expect(screen.getByLabelText(/location type/i)).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("select-location-type-error")).toHaveTextContent("Classification is not allowed.");
  });

  it("groups the type filter into Places and Locations and sends each option's backend name", async () => {
    const list = vi.spyOn(services.locations, "list");
    renderLocations();
    const filter = await screen.findByLabelText("TYPE");
    fireEvent.click(filter);

    const groups = within(screen.getByRole("listbox")).getAllByRole("group").map((group) => ({
      label: group.getAttribute("aria-labelledby") ? document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent : null,
      options: within(group).getAllByRole("option").map((option) => option.textContent),
    }));
    expect(groups).toEqual([
      { label: "Places", options: ["College", "Campus Services", "Food", "Parking", "Facility"] },
      { label: "Locations", options: ["Room", "Office", "Laboratory", "Restroom"] },
    ]);

    for (const value of ["College", "Campus Services", "Food", "Parking", "Facility", "Room", "Restroom"]) {
      chooseFilterOption("TYPE", value);
      await waitFor(() => expect(list).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ type: value })));
    }
  });

  describe("a Place whose classification the backend did not send", () => {
    const place = (id: string, name: string, classification?: "College") => ({ id, name, code: id.toUpperCase(), type: "Place" as const, ...(classification ? { classification } : {}), parentId: null, function: "Campus building", status: "Active" as const, lat: null, lng: null, positioned: false });
    const unclassified = place("unclassified-1", "Unclassified Hall");
    const college = place("college-1", "Badge College", "College");
    const child = { id: "unclassified-room", name: "Unclassified Room", code: "UNCL-ROOM", type: "Room" as const, parentId: unclassified.id, building: unclassified.name, floor: "Ground Floor", function: "Room", status: "Active" as const, lat: null, lng: null, positioned: false };

    it("badges only Places without a classification as Unclassified, and still lists their Locations", async () => {
      const records = [unclassified, college, child];
      vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });
      renderLocations();
      fireEvent.click(await screen.findByRole("button", { name: /toggle view mode/i }));

      const unclassifiedRow = await screen.findByRole("row", { name: /Unclassified Hall/ });
      const collegeRow = screen.getByRole("row", { name: /Badge College/ });
      expect(within(unclassifiedRow).getByText("Unclassified")).toBeInTheDocument();
      expect(within(collegeRow).queryByText("Unclassified")).not.toBeInTheDocument();
      expect(screen.getByRole("row", { name: /Unclassified Room/ })).toBeInTheDocument();
    });

    it("is not offered as the parent of a new indoor Location", async () => {
      const records = [unclassified, college];
      vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });
      renderLocations();
      fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
      fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });
      const combobox = screen.getByLabelText("PARENT BUILDING");
      fireEvent.focus(combobox);
      fireEvent.change(combobox, { target: { value: "" } });

      const listed = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent ?? "");
      expect(listed.some((option) => option.includes("Badge College"))).toBe(true);
      expect(listed.some((option) => option.includes("Unclassified Hall"))).toBe(false);
    });

    it("still warns that deleting it removes its indoor Locations", async () => {
      const records = [unclassified, child];
      vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });
      renderLocations();
      fireEvent.click(await screen.findByRole("button", { name: `Actions for ${unclassified.name}` }));
      fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
      expect(await screen.findByText("This Building contains 1 associated Indoor Locations. Deleting this Building will permanently remove it and its child Locations. This action cannot be undone.")).toBeInTheDocument();
    });

    it("cannot be saved until the admin chooses a classification", async () => {
      const records = [unclassified];
      vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });
      const save = vi.spyOn(services.locations, "save").mockImplementation(async (draft) => ({ ...draft, id: draft.id ?? "x" }) as never);
      renderLocations();
      fireEvent.click(await screen.findByRole("button", { name: `Actions for ${unclassified.name}` }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

      const typeSelect = await screen.findByLabelText(/location type/i) as HTMLSelectElement;
      expect(typeSelect).toHaveValue("");
      expect(Array.from(typeSelect.options).map((option) => option.value)).not.toContain("Building");
      fireEvent.click(screen.getByRole("button", { name: /save location/i }));
      expect((await screen.findAllByText("Select a classification.")).length).toBeGreaterThan(0);
      expect(save).not.toHaveBeenCalled();

      fireEvent.change(typeSelect, { target: { value: "College" } });
      fireEvent.click(screen.getByRole("button", { name: /save location/i }));
      await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: "Place", classification: "College" }), expect.anything()));
    });
  });

  it("keeps row action options above neighboring table rows", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Administration Building" }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeVisible();
    expect(menu.parentElement?.parentElement).toHaveStyle({ zIndex: "50" });
    const editOption = screen.getByRole("menuitem", { name: "Edit location" });
    expect(editOption).toBeVisible();
    fireEvent.mouseDown(editOption);
    fireEvent.click(editOption);
    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
  });

  it("does not expose bulk location import in the directory", async () => {
    renderLocations();
    await screen.findByRole("button", { name: /add location/i });
    expect(screen.queryByRole("button", { name: /bulk import/i })).not.toBeInTheDocument();
  });

  it("saves description and keywords to their independent directory columns", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: "Saved fields test" } });
    fireEvent.change(screen.getByLabelText(/location code/i), { target: { value: "SAVED-FIELDS" } });
    fireEvent.change(screen.getByLabelText("DESCRIPTION"), { target: { value: "Saved purpose" } });
    fireEvent.change(screen.getByLabelText(/keywords/i), { target: { value: "saved, keywords" } });
    chooseParentBuilding("Science Building");
    fireEvent.change(screen.getByLabelText("FLOOR LEVEL"), { target: { value: "Ground Floor" } });
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Saved fields test" } });
    expect(await screen.findByText("Saved purpose")).toBeInTheDocument();
    // Keywords are no longer a table column; they stay persisted and searchable.
    expect(screen.queryByText("saved, keywords")).not.toBeInTheDocument();
    const saved = (await services.locations.list("saved, keywords", 1, 10)).items.find((item) => item.name === "Saved fields test");
    expect(saved?.keywords).toBe("saved, keywords");
  });

  it("refuses to delete until the admin password is confirmed", async () => {
    const record = await services.locations.save({ id: "password-guard-test", name: "Password guard test", code: "PWD-GUARD", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const remove = vi.spyOn(services.locations, "remove");
    renderLocations(["/locations?q=Password%20guard%20test"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));

    // An empty prompt stops the delete before it reaches the service.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Enter your password to confirm this deletion.")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    // So does the wrong password.
    confirmDeletePassword("not-my-password");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Password is incorrect")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /delete location/i })).toBeInTheDocument();

    // The admin's own password releases it.
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(record.id, record.classification));
    expect(await screen.findByText(`${record.name} was deleted successfully.`)).toBeInTheDocument();
  });

  it("re-prompts when the backend reports the password confirmation expired", async () => {
    const record = await services.locations.save({ id: "expired-confirmation", name: "Expired confirmation", code: "EXPIRED-CONF", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    vi.spyOn(services.locations, "remove").mockRejectedValueOnce(new PasswordConfirmationRequiredError());
    renderLocations(["/locations?q=Expired%20confirmation"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/Your password confirmation expired/)).toBeInTheDocument();
    // The record survives and the prompt is cleared for a fresh attempt.
    expect(screen.getByRole("dialog", { name: /delete location/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm your password")).toHaveValue("");
  });

  it("shows a delete failure alert and leaves the record visible", async () => {
    const record = await services.locations.save({ id: "delete-error-test", name: "Delete error test", code: "DELETE-ERROR", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    setMockFailure("locationRemove", true);
    renderLocations(["/locations?q=Delete%20error%20test"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Mock locationRemove failed/);
    expect(screen.getByText(record.name)).toBeInTheDocument();
    setMockFailure("locationRemove", false);
  });

  it("warns about connected children and permanently deletes the building hierarchy", async () => {
    const building = await services.locations.save({ id: "ui-deleted-building", name: "UI Deleted Building", code: "UI-DELETED-BLDG", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const child = await services.locations.save({ id: "ui-deleted-room", name: "UI Deleted Room", code: "UI-DELETED-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations([`/locations?q=${encodeURIComponent(building.name)}`]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    expect(await screen.findByText("This Building contains 1 associated Indoor Locations. Deleting this Building will permanently remove it and its child Locations. This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Delete ${building.name}`))).toBeInTheDocument();
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => {
      expect((await services.locations.list()).items.some((item) => item.id === building.id || item.id === child.id)).toBe(false);
    });
    expect(await screen.findByText(`${building.name} was deleted successfully.`)).toBeInTheDocument();
  });

  it("renders a selected location's real history entry", async () => {
    const record = await services.locations.save({ id: "history-test", name: "History test", code: "HISTORY", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const historySpy = vi.spyOn(services.logs, "forLocation").mockResolvedValue({
      items: [{ id: "history-1", actor: "admin01", action: "Updated Location", target: record.name, targetId: record.id, detail: "Name changed", createdAt: "Just now", category: "Admin" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderLocations(["/locations?q=History%20test"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /view history/i }));
    expect(await screen.findByRole("heading", { name: "Audit History" })).toBeInTheDocument();
    expect(await screen.findByText("Updated Location")).toBeInTheDocument();
    expect(historySpy).toHaveBeenCalledWith(record.id, record.name, record.classification);
  });

  it("keeps description and keywords independent and reflects a selected photo", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    const description = screen.getByLabelText("DESCRIPTION");
    const keywords = screen.getByLabelText(/keywords/i);
    fireEvent.change(description, { target: { value: "Independent description" } });
    fireEvent.change(keywords, { target: { value: "lab, computers" } });
    expect(description).toHaveValue("Independent description");
    expect(keywords).toHaveValue("lab, computers");

    fireEvent.change(screen.getByLabelText(/upload location photo/i), {
      target: { files: [new File(["image"], "campus.jpg", { type: "image/jpeg" })] },
    });
    // The picker prepares a file before adding it, so the name lands a tick later.
    expect(await screen.findByText("campus.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
    expect(screen.queryByText("campus.jpg")).not.toBeInTheDocument();
  });

  it("enters, contains, and restores focus for a dismissible dialog", async () => {
    renderLocations();
    const addButton = await screen.findByRole("button", { name: /add location/i });
    addButton.focus();
    fireEvent.click(addButton);

    const dialog = await screen.findByRole("dialog", { name: "Add Location" });
    expect(dialog).toHaveAttribute("aria-describedby", "location-form-description");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("aria-label", "Close location dialog"));

    const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select"));
    controls[controls.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Location" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(addButton);
  });

  it("parks focus on the directory when the deleted row takes the opener with it", async () => {
    const record = await services.locations.save({ id: "focus-after-delete", name: "Focus after delete", code: "FOCUS-DEL", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations(["/locations?q=Focus%20after%20delete"]);
    const opener = await screen.findByRole("button", { name: `Actions for ${record.name}` });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText(`${record.name} was deleted successfully.`);
    // The opener went away with its row, so focus must not be dropped on <body>:
    // tabbing would otherwise restart at the top of the page.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Location Directory" })));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("associates validation messages with their fields", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));

    const nameInput = await screen.findByLabelText(/location name/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput.getAttribute("aria-describedby")).toContain("field-location-name-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Location name is required.");
  });

  describe("BUILDING filter combobox", () => {
    const seedFilterBuildings = async () => {
      const place = (id: string, name: string, code: string) => services.locations.save({ id, name, code, type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
      await place("combo-alpha", "Combo Alpha Hall", "COMBO-A");
      await place("combo-beta", "Combo Beta Hall", "COMBO-B");
      await services.locations.save({ id: "combo-alpha-room", name: "Combo Alpha Room", code: "COMBO-AR", type: "Room", parentId: "combo-alpha", building: "Combo Alpha Hall", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false });
      await services.locations.save({ id: "combo-beta-room", name: "Combo Beta Room", code: "COMBO-BR", type: "Room", parentId: "combo-beta", building: "Combo Beta Hall", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    };

    it("lists options in a height-limited scrolling list with All Buildings first", async () => {
      await seedFilterBuildings();
      renderLocations(["/locations?q=Combo"]);
      const combobox = await screen.findByLabelText("BUILDING");
      fireEvent.focus(combobox);
      const listbox = screen.getByRole("listbox");
      expect(listbox).toHaveClass("filter-combobox-listbox");
      expect(within(listbox).getAllByRole("option")[0]).toHaveTextContent("All Buildings");
      expect(document.querySelector("select#select-building")).toBeNull();
    });

    it("shows a short placeholder and the full chosen name as a tooltip", async () => {
      await seedFilterBuildings();
      renderLocations(["/locations?q=Combo"]);
      const combobox = await screen.findByLabelText("BUILDING");
      expect(combobox).toHaveAttribute("placeholder", "Search buildings…");
      expect(combobox).not.toHaveAttribute("title");
      chooseFilterBuilding("Combo Beta Hall");
      expect(combobox).toHaveAttribute("title", "Combo Beta Hall");
    });

    it("narrows the list by name or code as it is typed", async () => {
      await seedFilterBuildings();
      renderLocations(["/locations?q=Combo"]);
      const combobox = await screen.findByLabelText("BUILDING");
      fireEvent.focus(combobox);
      fireEvent.change(combobox, { target: { value: "combo-b" } });
      const names = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.querySelector(".parent-building-option-name")?.textContent);
      expect(names).toEqual(["Combo Beta Hall"]);
    });

    it("sets the Building filter and resets FLOOR, then All Buildings clears it", async () => {
      await seedFilterBuildings();
      renderLocations(["/locations?q=Combo"]);
      const floorSelect = await screen.findByLabelText("FLOOR");
      await waitFor(() => expect(filterOptionNames("FLOOR").length).toBeGreaterThan(1));
      chooseFilterOption("FLOOR", "2nd Floor");
      expect(selectedFilterOptionId("FLOOR")).toBe("floor-name:2nd Floor");
      expect(await screen.findByText("Combo Alpha Room")).toBeInTheDocument();
      expect(screen.queryByText("Combo Beta Room")).not.toBeInTheDocument();

      chooseFilterBuilding("Combo Beta Hall");
      expect(floorSelect).toHaveTextContent("All Floors");
      expect(selectedFilterOptionId("FLOOR")).toBeUndefined();
      expect(await screen.findByText("Combo Beta Room")).toBeInTheDocument();
      expect(screen.queryByText("Combo Alpha Room")).not.toBeInTheDocument();
      expect(screen.getByLabelText("BUILDING")).toHaveValue("Combo Beta Hall");

      const combobox = screen.getByLabelText("BUILDING");
      fireEvent.focus(combobox);
      fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "All Buildings" }));
      expect(combobox).toHaveValue("All Buildings");
      expect(await screen.findByText("Combo Alpha Room")).toBeInTheDocument();
    });

    it("chooses with the keyboard and closes on Escape or an outside click", async () => {
      await seedFilterBuildings();
      renderLocations(["/locations?q=Combo"]);
      const combobox = await screen.findByLabelText("BUILDING");
      fireEvent.change(combobox, { target: { value: "Combo" } });
      fireEvent.keyDown(combobox, { key: "ArrowDown" });
      fireEvent.keyDown(combobox, { key: "Enter" });
      expect(combobox).toHaveValue("Combo Beta Hall");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(await screen.findByText("Combo Beta Room")).toBeInTheDocument();
      expect(screen.queryByText("Combo Alpha Room")).not.toBeInTheDocument();

      fireEvent.focus(combobox);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      fireEvent.keyDown(combobox, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(combobox).toHaveValue("Combo Beta Hall");

      fireEvent.focus(combobox);
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("scrolls the selected option into view when opening", async () => {
      await seedFilterBuildings();
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderLocations(["/locations?q=Combo"]);
        await waitFor(() => chooseFilterBuilding("Combo Beta Hall"));
        scrollIntoView.mockClear();
        fireEvent.focus(screen.getByLabelText("BUILDING"));
        expect(scrollIntoView).toHaveBeenCalled();
        expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true })).toHaveTextContent("Combo Beta Hall");
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });
  });

  describe("TYPE, FLOOR and STATUS filter dropdowns", () => {
    const activeOption = (field: HTMLElement) =>
      document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.querySelector(".parent-building-option-name")?.textContent;

    it("opens the same popover as BUILDING from a select-only combobox, not a native select", async () => {
      renderLocations();
      for (const label of ["TYPE", "FLOOR", "STATUS"]) {
        const field = await screen.findByLabelText(label);
        expect(field).toHaveAttribute("role", "combobox");
        expect(field).toHaveAttribute("aria-haspopup", "listbox");
        expect(field).toHaveAttribute("aria-expanded", "false");
        // Nothing to edit, so it is not announced as a text box.
        expect(screen.queryByRole("textbox", { name: label })).toBeNull();
        expect(screen.getByRole("combobox", { name: label })).toBe(field);
        expect(field.tagName).not.toBe("INPUT");

        fireEvent.click(field);
        expect(field).toHaveAttribute("aria-expanded", "true");
        const listbox = screen.getByRole("listbox");
        expect(listbox).toHaveClass("filter-combobox-listbox");
        expect(listbox.closest(".parent-building-popover")).not.toBeNull();
        fireEvent.click(field);
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      }
      expect(document.querySelector("select#select-type, select#select-floor, select#select-status")).toBeNull();
    });

    it("lists the clearing option first, marks the chosen one, and clears back to it", async () => {
      renderLocations();
      const type = await screen.findByLabelText("TYPE");
      expect(type).toHaveTextContent("All Types");
      expect(screen.getByLabelText("FLOOR")).toHaveTextContent("All Floors");
      expect(screen.getByLabelText("STATUS")).toHaveTextContent("All Statuses");
      expect(filterOptionNames("TYPE")[0]).toBe("All Types");
      fireEvent.click(type);
      expect(within(screen.getByRole("listbox")).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(type, { key: "Escape" });

      chooseFilterOption("TYPE", "Laboratory");
      expect(type).toHaveTextContent("Laboratory");
      fireEvent.click(type);
      expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true })).toHaveTextContent("Laboratory");
      fireEvent.keyDown(type, { key: "Escape" });

      chooseFilterOption("TYPE", "All Types");
      expect(type).toHaveTextContent("All Types");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(filterOptionNames("FLOOR")[0]).toBe("All Floors");
      expect(filterOptionNames("STATUS")).toEqual(["All Statuses", "Active", "Inactive"]);
    });

    it("keeps group headings out of the options and does nothing when one is clicked", async () => {
      renderLocations();
      const type = await screen.findByLabelText("TYPE");
      expect(filterOptionNames("TYPE")).toEqual(["All Types", "College", "Campus Services", "Food", "Parking", "Facility", "Room", "Office", "Laboratory", "Restroom"]);
      fireEvent.click(type);
      const listbox = screen.getByRole("listbox");
      expect(within(listbox).queryByRole("option", { name: "Places" })).toBeNull();
      expect(within(listbox).queryByRole("option", { name: "Locations" })).toBeNull();

      fireEvent.click(screen.getByText("Places"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(type).toHaveTextContent("All Types");
    });

    it("navigates by keyboard, stepping over group headings, and chooses with Enter", async () => {
      renderLocations();
      const type = await screen.findByLabelText("TYPE");
      type.focus();
      fireEvent.keyDown(type, { key: "ArrowDown" });
      expect(type).toHaveAttribute("aria-expanded", "true");
      expect(activeOption(type)).toBe("All Types");

      const walked: Array<string | null | undefined> = [];
      for (let step = 0; step < 7; step += 1) {
        fireEvent.keyDown(type, { key: "ArrowDown" });
        walked.push(activeOption(type));
      }
      // From Facility (last Place) the next stop is Room: the "Locations" heading is skipped.
      expect(walked).toEqual(["College", "Campus Services", "Food", "Parking", "Facility", "Room", "Office"]);
      fireEvent.keyDown(type, { key: "ArrowUp" });
      fireEvent.keyDown(type, { key: "ArrowUp" });
      expect(activeOption(type)).toBe("Facility");
      fireEvent.keyDown(type, { key: "End" });
      expect(activeOption(type)).toBe("Restroom");
      fireEvent.keyDown(type, { key: "Home" });
      expect(activeOption(type)).toBe("All Types");

      fireEvent.keyDown(type, { key: "End" });
      fireEvent.keyDown(type, { key: "Enter" });
      expect(type).toHaveTextContent("Restroom");
      expect(type).toHaveAttribute("aria-expanded", "false");
      expect(type).not.toHaveAttribute("aria-activedescendant");
    });

    it("opens with Enter, Space or ArrowDown on the closed field, and closes on Escape, Tab or an outside click", async () => {
      renderLocations();
      const status = await screen.findByLabelText("STATUS");
      for (const key of ["Enter", " ", "ArrowDown"]) {
        fireEvent.keyDown(status, { key });
        expect(status).toHaveAttribute("aria-expanded", "true");
        fireEvent.keyDown(status, { key: "Escape" });
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(status).toHaveAttribute("aria-expanded", "false");
      }
      fireEvent.keyDown(status, { key: "Enter" });
      fireEvent.keyDown(status, { key: "Tab" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      fireEvent.click(status);
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(status).toHaveTextContent("All Statuses");

      // Space on an open list picks the highlighted option, like Enter.
      fireEvent.keyDown(status, { key: " " });
      fireEvent.keyDown(status, { key: "ArrowDown" });
      fireEvent.keyDown(status, { key: " " });
      expect(status).toHaveTextContent("Active");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("picks a STATUS by typing its first letter, as a native select did", async () => {
      renderLocations();
      const status = await screen.findByLabelText("STATUS");
      fireEvent.keyDown(status, { key: "i" });
      expect(activeOption(status)).toBe("Inactive");
      fireEvent.keyDown(status, { key: "Enter" });
      expect(status).toHaveTextContent("Inactive");
      expect(selectedFilterOptionId("STATUS")).toBe("Inactive");
    });

    it("filters by STATUS and restores every row when All Statuses is chosen", async () => {
      const place = (id: string, name: string, status: "Active" | "Inactive") => services.locations.save({ id, name, code: id.toUpperCase(), type: "Place", classification: "College", parentId: null, status, lat: null, lng: null, positioned: false });
      await place("status-probe-live", "Status Probe Live", "Active");
      await place("status-probe-dormant", "Status Probe Dormant", "Inactive");
      const list = vi.spyOn(services.locations, "list");
      renderLocations(["/locations?q=Status%20Probe"]);
      expect(await screen.findByText("Status Probe Live")).toBeInTheDocument();
      expect(screen.getByText("Status Probe Dormant")).toBeInTheDocument();

      chooseFilterOption("STATUS", "Inactive");
      expect(screen.getByLabelText("STATUS")).toHaveTextContent("Inactive");
      await waitFor(() => expect(screen.queryByText("Status Probe Live")).not.toBeInTheDocument());
      expect(screen.getByText("Status Probe Dormant")).toBeInTheDocument();
      expect(list).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ status: "Inactive" }));

      chooseFilterOption("STATUS", "All Statuses");
      expect(await screen.findByText("Status Probe Live")).toBeInTheDocument();
      expect(screen.getByText("Status Probe Dormant")).toBeInTheDocument();
    });

    it("filters by FLOOR through the same dropdown", async () => {
      await services.locations.save({ id: "floor-dd-building", name: "Floor Dropdown Hall", code: "FLOOR-DD", type: "Place", classification: "College", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
      await services.locations.save({ id: "floor-dd-ground", name: "Floor Dropdown Ground Room", code: "FLOOR-DD-G", type: "Room", parentId: "floor-dd-building", building: "Floor Dropdown Hall", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
      await services.locations.save({ id: "floor-dd-second", name: "Floor Dropdown Second Room", code: "FLOOR-DD-S", type: "Room", parentId: "floor-dd-building", building: "Floor Dropdown Hall", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false });
      renderLocations(["/locations?q=Floor%20Dropdown"]);
      expect(await screen.findByText("Floor Dropdown Ground Room")).toBeInTheDocument();

      await waitFor(() => expect(filterOptionNames("FLOOR")).toContain("2nd Floor"));
      chooseFilterOption("FLOOR", "2nd Floor");
      expect(await screen.findByText("Floor Dropdown Second Room")).toBeInTheDocument();
      expect(screen.queryByText("Floor Dropdown Ground Room")).not.toBeInTheDocument();

      chooseFilterOption("FLOOR", "All Floors");
      expect(await screen.findByText("Floor Dropdown Ground Room")).toBeInTheDocument();
    });
  });
});
