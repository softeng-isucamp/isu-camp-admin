import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Locations } from "./Locations";
import { services, setMockFailure } from "../../services/api";

function renderLocations(initialEntries: Array<string | { pathname: string; search?: string; state?: unknown }> = ["/locations"]) {
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
    const typeSelect = await screen.findByLabelText("TYPE");
    expect(Array.from((typeSelect as HTMLSelectElement).options).map((option) => option.value)).not.toContain("Floor");
    expect(Array.from((screen.getByLabelText("FLOOR") as HTMLSelectElement).options).map((option) => option.text)).toContain("Ground Floor");
  });

  it("renders Floor Levels as grouping rows without location metadata", async () => {
    renderLocations();
    const floorRow = (await screen.findAllByRole("row"))
      .find((row) => row.querySelector("strong")?.textContent === "Ground Floor");

    expect(floorRow).toBeDefined();
    expect(floorRow).toHaveTextContent("Ground Floor");
    expect(floorRow).not.toHaveTextContent("Active");
    expect(floorRow).not.toHaveTextContent("BLD-ADM-01-Ground Floor");
    expect(floorRow?.querySelectorAll("td")).toHaveLength(1);
    expect(floorRow?.querySelector("td")).toHaveAttribute("colspan", "6");
  });

  it("keeps flat-view pagination record-based and resets to page one after filtering", async () => {
    const { container } = renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    fireEvent.click(screen.getByRole("button", { name: /toggle view mode/i }));
    expect(await screen.findByText(/Showing 1–10 of/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByText(/Showing 11–20 of/i)).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    fireEvent.change(screen.getByLabelText("TYPE"), { target: { value: "Building" } });
    expect(await screen.findByText(/Showing 1–10 of/i)).toBeInTheDocument();
  });

  it("paginates hierarchy families atomically across the old page boundary", async () => {
    for (let index = 1; index <= 11; index += 1) {
      const buildingId = `pagination-family-building-${index}`;
      await services.locations.save({
        id: buildingId,
        name: `Pagination Family ${index}`,
        code: `PAG-${index}`,
        type: "Building",
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
    expect(screen.getAllByText("Pagination Family 11").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Pagination Family Room 11").length).toBeGreaterThan(0);
    expect(screen.queryByRole("row", { name: /Pagination Family Room 10/ })).not.toBeInTheDocument();
  });

  it("uses building IDs to isolate duplicate building names", async () => {
    await services.locations.save({ id: "duplicate-building-a", name: "Duplicate Building", code: "DUP-A", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-building-b", name: "Duplicate Building", code: "DUP-B", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-room-a", name: "Room in duplicate A", code: "DUP-ROOM-A", type: "Room", parentId: "duplicate-building-a", building: "Duplicate Building", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "duplicate-room-b", name: "Room in duplicate B", code: "DUP-ROOM-B", type: "Room", parentId: "duplicate-building-b", building: "Duplicate Building", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();
    const buildingSelect = await screen.findByLabelText("BUILDING");
    const duplicateOptions = Array.from((buildingSelect as HTMLSelectElement).options).filter((option) => option.text === "Duplicate Building");
    expect(duplicateOptions.map((option) => option.value)).toEqual(["duplicate-building-a", "duplicate-building-b"]);

    fireEvent.change(buildingSelect, { target: { value: "duplicate-building-b" } });
    expect(await screen.findByText("Room in duplicate B")).toBeInTheDocument();
    expect(screen.queryByText("Room in duplicate A")).not.toBeInTheDocument();
  });

  it("resets stale Building and Floor selections after the selected Building is deleted", async () => {
    const building = await services.locations.save({ id: "stale-filter-building", name: "Stale Filter Building", code: "STALE-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "stale-filter-room", name: "Stale Filter Room", code: "STALE-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();
    const buildingSelect = await screen.findByLabelText("BUILDING");
    const floorSelect = screen.getByLabelText("FLOOR");
    fireEvent.change(buildingSelect, { target: { value: building.id } });
    await waitFor(() => expect((floorSelect as HTMLSelectElement).options.length).toBeGreaterThan(1));
    fireEvent.change(floorSelect, { target: { value: `${building.id}-floor-Ground Floor` } });
    expect(floorSelect).toHaveValue(`${building.id}-floor-Ground Floor`);

    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(buildingSelect).toHaveValue("All Buildings");
      expect(floorSelect).toHaveValue("All Floors");
    });
  });

  it("returns to the last hierarchy page after a mutation shrinks the result", async () => {
    for (let index = 1; index <= 11; index += 1) {
      await services.locations.save({ id: `shrink-page-building-${index}`, name: `Shrink Page ${index}`, code: `SHRINK-${index}`, type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    }
    renderLocations(["/locations?q=Shrink%20Page"]);
    expect(await screen.findByText("Shrink Page 11")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByRole("row", { name: /Shrink Page 11/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Shrink Page 11" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–10 of 10/)).toBeInTheDocument();
      expect(Array.from(document.querySelectorAll("tbody tr")).some((row) => row.querySelector("strong")?.textContent === "Shrink Page 1")).toBe(true);
      expect(screen.queryByRole("row", { name: /Shrink Page 11/ })).not.toBeInTheDocument();
    });
  });

  it("does not attach a normal child with a duplicate legacy building name to both roots", async () => {
    await services.locations.save({ id: "legacy-name-building-a", name: "Same Name Root", code: "SAME-A", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "legacy-name-building-b", name: "Same Name Root", code: "SAME-B", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "authoritative-child", name: "Authoritative Child", code: "AUTH-CHILD", type: "Room", parentId: "legacy-name-building-b", building: "Same Name Root", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    renderLocations(["/locations?q=Authoritative%20Child"]);
    expect(await screen.findByText("Authoritative Child")).toBeInTheDocument();
    expect(screen.getAllByRole("row", { name: /Same Name Root/ })).toHaveLength(1);
  });

  it("renders an orphaned duplicate-name record as an ungrouped row", async () => {
    const records = [
      { id: "orphan-building-a", name: "Orphan Duplicate Building", code: "ORPHAN-A", type: "Building" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
      { id: "orphan-building-b", name: "Orphan Duplicate Building", code: "ORPHAN-B", type: "Building" as const, parentId: null, status: "Active" as const, lat: null, lng: null, positioned: false },
      { id: "orphan-room", name: "Orphan Room", code: "ORPHAN-ROOM", type: "Room" as const, parentId: null, building: "Orphan Duplicate Building", floor: "Ground Floor", status: "Active" as const, lat: null, lng: null, positioned: false },
    ];
    vi.spyOn(services.locations, "list").mockResolvedValue({ items: records, total: records.length, page: 1, pageSize: 100 });

    renderLocations(["/locations?q=Orphan%20Room"]);
    const orphanRow = await screen.findByRole("row", { name: /Orphan Room/ });
    expect(orphanRow).toHaveTextContent("Orphan Room");
    expect(screen.queryAllByRole("row", { name: /Orphan Duplicate Building/ })).toHaveLength(0);
  });

  it("filters same-named floors by their distinct record IDs", async () => {
    const seed = async (id: string, name: string, type: "Building" | "Floor" | "Room", parentId: string | null) => services.locations.save({ id, name, code: id.toUpperCase(), type, parentId, status: "Active", lat: null, lng: null, positioned: false });
    await seed("floor-building-a", "Floor building A", "Building", null);
    await seed("floor-building-b", "Floor building B", "Building", null);
    await seed("floor-a", "Level One", "Floor", "floor-building-a");
    await seed("floor-b", "Level One", "Floor", "floor-building-b");
    await services.locations.save({ id: "floor-child-a", name: "Only floor A child", code: "FLOOR-CHILD-A", type: "Room", parentId: "floor-building-a", building: "Floor building A", floor: "Level One", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "floor-child-b", name: "Only floor B child", code: "FLOOR-CHILD-B", type: "Room", parentId: "floor-building-b", building: "Floor building B", floor: "Level One", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    const floorSelect = await screen.findByLabelText("FLOOR");
    const identicalNameOptions = Array.from((floorSelect as HTMLSelectElement).options).filter((option) => option.text === "Level One");
    expect(identicalNameOptions.map((option) => option.value)).toEqual(expect.arrayContaining(["floor-a", "floor-b"]));
    fireEvent.change(floorSelect, { target: { value: "floor-a" } });
    expect(await screen.findByText("Only floor A child")).toBeInTheDocument();
    expect(screen.queryByText("Only floor B child")).not.toBeInTheDocument();
  });

  it("keeps only matching indoor locations while retaining building and floor context in search", async () => {
    renderLocations(["/locations?q=Laboratory%20107"]);

    await screen.findByText("Administration Building 2nd Floor Laboratory 107");
    expect((await screen.findAllByText("Administration Building")).length).toBeGreaterThan(1);
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
    await services.locations.save({ id: "unpositioned-icon-test", name: "Unpositioned icon test", code: "ICON-TEST", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
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

    renderLocations();
    const administrationBuildingMatches = await screen.findAllByText("Administration Building", {}, { timeout: 4000 });
    expect(administrationBuildingMatches.length).toBeGreaterThanOrEqual(1);
    const administrationFloorMatches = await screen.findAllByText("Administration Floor 2", {}, { timeout: 4000 });
    expect(administrationFloorMatches.length).toBeGreaterThanOrEqual(1);

    // Find collapse button for Administration Building
    const collapseButton = await screen.findByRole("button", { name: /collapse Administration Building/i });
    fireEvent.click(collapseButton);

    // Expand button is now available
    const expandButton = await screen.findByRole("button", { name: /expand Administration Building/i });
    fireEvent.click(expandButton);
    expect((await screen.findAllByText("Administration Floor 2")).length).toBeGreaterThanOrEqual(1);
  });

  it("opens and interacts with the Add Location modal with Figma fields", async () => {
    renderLocations();
    const addLocationButton = await screen.findByRole("button", { name: /\+ add location|add location/i }, { timeout: 4000 });
    fireEvent.click(addLocationButton);

    expect(await screen.findByRole("heading", { name: /add location/i })).toBeInTheDocument();
    expect(screen.getByText(/add a room, office, laboratory, or restroom under an existing building/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
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
      type: "Building",
      parentId: null,
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    });

    renderLocations([`/locations?add=indoor&parentId=${building.id}&floor=${encodeURIComponent("2nd Floor")}`]);

    const dialog = await screen.findByRole("dialog", { name: "Add Location" });
    expect(screen.getByLabelText(/location type/i)).toHaveValue("Room");
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(building.id);
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
      type: "Building" as const,
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
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(pendingBuilding.id);
    expect(screen.getByLabelText("PARENT BUILDING")).toBeDisabled();
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("Ground Floor");
    expect(dialog).toHaveTextContent("Pending Map Building");
    expect(screen.queryByText("The selected Building is unavailable for an Indoor Location handoff.")).not.toBeInTheDocument();
  });


  it("creates a child location with a parent building and standard floor level", async () => {
    const building = await services.locations.save({ id: "hierarchy-test-building", name: "Hierarchy Test Building", code: "HIER-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    expect(Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "Laboratory", "Room", "Office", "Restroom",
    ]);
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Room" } });
    const parentBuilding = screen.getByLabelText("PARENT BUILDING");
    const floorLevel = screen.getByLabelText("FLOOR LEVEL");
    expect(parentBuilding).toHaveDisplayValue("None / Standalone");
    expect(Array.from((parentBuilding as HTMLSelectElement).options).find((option) => option.text === building.name)).toHaveValue(building.id);
    expect(Array.from((floorLevel as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "None",
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
      "3rd Floor",
      "4th Floor",
      "5th Floor",
      "Basement",
    ]);
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: "Hierarchy Test Room" } });
    fireEvent.change(screen.getByLabelText(/location code/i), { target: { value: "HIER-ROOM" } });
    fireEvent.change(parentBuilding, { target: { value: building.id } });
    fireEvent.change(floorLevel, { target: { value: "2nd Floor" } });
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));
    await screen.findByText(/saved successfully/i);
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

  it("populates the parent building and floor level when editing a child location", async () => {
    const building = await services.locations.save({ id: "edit-child-building", name: "Edit Child Building", code: "EDIT-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-child-room", name: "Edit Child Room", code: "EDIT-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Basement", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Child Room" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Child Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(building.id);
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("Basement");
  });

  it("offers only Building and Facility when editing a Building and excludes Facility for indoor locations", async () => {
    const building = await services.locations.save({ id: "edit-type-building", name: "Edit Type Building", code: "EDIT-TYPE-BLDG", type: "Building", parentId: null, function: "Academic building", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-type-room", name: "Edit Type Room", code: "EDIT-TYPE-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-type-facility", name: "Edit Type Facility", code: "EDIT-TYPE-FACILITY", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });

    renderLocations();

    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: building.name } });
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    expect(Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "Building",
      "Facility",
    ]);
    expect(screen.getByLabelText("Latitude")).toHaveValue("Not positioned");
    expect(screen.getByLabelText("Longitude")).toHaveValue("Not positioned");
    expect(screen.queryByText("Spatial position is managed in Map Editor.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Facility" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    expect(await screen.findByText("Location updated")).toBeInTheDocument();
    const updatedBuilding = (await services.locations.list(building.name)).items.find((item) => item.id === building.id);
    expect(updatedBuilding?.type).toBe("Facility");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Type Room" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Type Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    const indoorTypeOptions = Array.from((await screen.findByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text);
    expect(indoorTypeOptions).not.toContain("Facility");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Longitude")).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Edit Type Facility" } });
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Type Facility" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));

    expect(await screen.findByLabelText(/location type/i)).toHaveValue("Facility");
    expect(Array.from((screen.getByLabelText(/location type/i) as HTMLSelectElement).options).map((option) => option.text)).toEqual(["Facility"]);
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
    fireEvent.change(screen.getByLabelText("PARENT BUILDING"), { target: { value: "osm-location-c5fb7a267a8ca63d" } });
    fireEvent.change(screen.getByLabelText("FLOOR LEVEL"), { target: { value: "Ground Floor" } });
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByLabelText(/search locations/i), { target: { value: "Saved fields test" } });
    expect(await screen.findByText("Saved purpose")).toBeInTheDocument();
    expect(screen.getByText("saved, keywords")).toBeInTheDocument();
  });

  it("shows a delete failure alert and leaves the record visible", async () => {
    const record = await services.locations.save({ id: "delete-error-test", name: "Delete error test", code: "DELETE-ERROR", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    setMockFailure("locationRemove", true);
    renderLocations(["/locations?q=Delete%20error%20test"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Mock locationRemove failed/);
    expect(screen.getByText(record.name)).toBeInTheDocument();
    setMockFailure("locationRemove", false);
  });

  it("warns about connected children and permanently deletes the building hierarchy", async () => {
    const building = await services.locations.save({ id: "ui-deleted-building", name: "UI Deleted Building", code: "UI-DELETED-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const child = await services.locations.save({ id: "ui-deleted-room", name: "UI Deleted Room", code: "UI-DELETED-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations([`/locations?q=${encodeURIComponent(building.name)}`]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${building.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete location/i }));
    expect(await screen.findByText("This Building contains 1 associated Indoor Locations. Deleting this Building will permanently remove it and its child Locations. This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Delete ${building.name}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => {
      expect((await services.locations.list()).items.some((item) => item.id === building.id || item.id === child.id)).toBe(false);
    });
  });

  it("renders a selected location's real history entry", async () => {
    const record = await services.locations.save({ id: "history-test", name: "History test", code: "HISTORY", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
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
    expect(historySpy).toHaveBeenCalledWith(record.id, record.name, record.type);
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
    expect(screen.getByText("campus.jpg")).toBeInTheDocument();
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

  it("associates validation messages with their fields", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));

    const nameInput = await screen.findByLabelText(/location name/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput.getAttribute("aria-describedby")).toContain("field-location-name-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Location name is required.");
  });
});
