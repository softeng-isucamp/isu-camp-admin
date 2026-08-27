import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Locations } from "./Locations";
import { services, setMockFailure } from "../../services/api";

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

  it("uses ten rows in both views and communicates placement only through the icon", async () => {
    const { container } = renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Positioned location").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Positioned location")[0]).toHaveStyle({ background: "#d6ede0", opacity: "1" });
    expect(screen.queryByText("Not positioned")).not.toBeInTheDocument();
    expect(screen.queryByText("Positioned")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /toggle view mode/i }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("moves to the next ten-row page and resets to page one after filtering", async () => {
    const { container } = renderLocations();
    await screen.findByRole("heading", { name: "Campus Locations" });
    expect(screen.getByText(/Showing 1–10 of/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByText(/Showing 11–20 of/i)).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    fireEvent.change(screen.getByLabelText("TYPE"), { target: { value: "Building" } });
    expect(await screen.findByText(/Showing 1–10 of/i)).toBeInTheDocument();
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

    expect((await screen.findAllByText("Administration Building")).length).toBeGreaterThan(1);
    expect((await screen.findAllByText("2nd Floor")).length).toBeGreaterThan(0);
    expect(screen.getByText("Administration Building 2nd Floor Laboratory 107")).toBeInTheDocument();
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

  it("dims an unpositioned type icon without rendering placement status text", async () => {
    await services.locations.save({ id: "unpositioned-icon-test", name: "Unpositioned icon test", code: "ICON-TEST", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations(["/locations?q=Unpositioned%20icon%20test"]);
    const icon = await screen.findByLabelText("Unpositioned location");
    expect(icon).toHaveStyle({ opacity: "0.55", filter: "grayscale(1)" });
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
    expect(screen.getByText(/add a building, floor, room, office, laboratory, restroom, or facility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/location code \/ id/i)).toBeInTheDocument();

    // Cancel modal
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);
  });

  it("creates a child location with a parent building and standard floor level", async () => {
    const building = await services.locations.save({ id: "hierarchy-test-building", name: "Hierarchy Test Building", code: "HIER-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Facility" } });
    expect(screen.queryByLabelText("PARENT BUILDING")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("FLOOR LEVEL")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Floor" } });
    // Floor is legacy compatibility data and is intentionally not offered for new records.
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
      "Custom Floor Level",
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
    expect(await screen.findByText("Hierarchy Test Room")).toBeInTheDocument();
  });

  it("populates the parent building and floor level when editing a child location", async () => {
    const building = await services.locations.save({ id: "edit-child-building", name: "Edit Child Building", code: "EDIT-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "edit-child-room", name: "Edit Child Room", code: "EDIT-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "Basement", status: "Active", lat: null, lng: null, positioned: false });
    renderLocations(["/locations?q=Edit%20Child%20Room"]);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Edit Child Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit location" }));
    expect(await screen.findByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    expect(screen.getByLabelText("PARENT BUILDING")).toHaveValue(building.id);
    expect(screen.getByLabelText("FLOOR LEVEL")).toHaveValue("Basement");
  });

  it("opens the Bulk Import modal with a file input and template", async () => {
    renderLocations();
    const bulkImportButton = await screen.findByRole("button", { name: /bulk import/i }, { timeout: 4000 });
    fireEvent.click(bulkImportButton);

    expect(await screen.findByRole("heading", { name: /bulk import locations/i })).toBeInTheDocument();
    expect(screen.getByText(/validate campus location records before importing/i)).toBeInTheDocument();
    expect(screen.getByText(/upload json file/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose location json file/i)).toHaveAttribute("type", "file");
    expect(screen.getByRole("link", { name: /download template/i })).toHaveAttribute("download", "locations-bulk-template.json");
    expect(screen.getByText(/add new/i)).toBeInTheDocument();
    expect(screen.getByText(/update existing/i)).toBeInTheDocument();
  });

  it("reads a selected file, validates before commit, and clears validation when mode changes", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /bulk import/i }));
    const importRows = JSON.stringify([{ id: "file-import-test", name: "File import test", code: "FILE-TEST", type: "Facility", parentId: null, status: "Active", lat: null, lng: null }]);
    const importFile = { name: "locations.json", text: () => Promise.resolve(importRows) } as File;
    fireEvent.change(screen.getByLabelText(/choose location json file/i), { target: { files: [importFile] } });
    expect(await screen.findByText("locations.json selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(await screen.findByText(/Validation passed for 1 locations/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update existing" }));
    expect(screen.queryByText(/Validation passed/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add new" }));
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText(/Validation passed for 1 locations/i);
    fireEvent.click(screen.getByRole("button", { name: "Import Locations" }));
    expect(await screen.findByText(/locations imported successfully/i)).toBeInTheDocument();
    await waitFor(async () => {
      expect((await services.locations.list("File import test")).items).toEqual([
        expect.objectContaining({ id: "file-import-test", name: "File import test" }),
      ]);
    });
  });

  it("saves description and keywords to their independent directory columns", async () => {
    renderLocations();
    fireEvent.click(await screen.findByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location type/i), { target: { value: "Facility" } });
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: "Saved fields test" } });
    fireEvent.change(screen.getByLabelText(/location code/i), { target: { value: "SAVED-FIELDS" } });
    fireEvent.change(screen.getByLabelText("DESCRIPTION"), { target: { value: "Saved purpose" } });
    fireEvent.change(screen.getByLabelText(/keywords/i), { target: { value: "saved, keywords" } });
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
    renderLocations(["/locations?q=History%20test"]);
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${record.name}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /view history/i }));
    expect(await screen.findByRole("heading", { name: "Audit History" })).toBeInTheDocument();
    expect(await screen.findByText("Updated Location")).toBeInTheDocument();
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
