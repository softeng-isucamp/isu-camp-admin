import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { allPermissions, canPerform, viewOnlyPermissions } from "../../../lib/permissions";
import type { AdminPermissions, Building, Location, Pathway, RouteNode } from "../../../types";
import { buildingInspectorModel } from "../building/buildingInspectorModel";
import type { SelectedBuildingView } from "../building/selectedBuilding";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { locationInspectorModel } from "../location/locationInspectorModel";
import { pathPointInspectorModel, selectedPathwayInspectorModel } from "../pathway/pathwayInspectorModel";
import { routeNodeInspectorModel } from "../routeNode/routeNodeInspectorModel";

// How each inspector card answers the signed-in administrator's switches: an action the
// admin may not take is left out entirely, never disabled, and a card with none of them
// carries no overflow actions (the card then drops its ⋯ trigger).

const canWith = (permissions: AdminPermissions) => (action: Parameters<typeof canPerform>[1]) =>
  canPerform({ role: "admin", permissions }, action);
const only = (key: keyof AdminPermissions): AdminPermissions => ({ ...viewOnlyPermissions(), [key]: true });
const labels = (model: InspectorCardModel) => model.overflowActions.map((action) => action.label);
const renderDetails = (model: InspectorCardModel) => render(<>{model.details}</>);

const building: Building = { id: "b1", name: "Hall", code: "HALL", classification: "College", points: [[1, 1], [1, 2], [2, 2]], status: "Active" };
const view: SelectedBuildingView = { building, location: undefined, associationId: "b1", entrances: [], routable: false };
const noop = vi.fn();
const buildingActions = {
  onReshape: noop, onEditDetails: noop, onAddIndoorLocation: noop, onMarkIndoorLocation: noop, onAddEntrance: noop,
  onToggleLinkEntrance: noop, onLinkEntrance: noop, onDelete: noop,
};
const buildingModel = (permissions: AdminPermissions, linkingEntrance = false, selected: SelectedBuildingView = view, contentLocations: Location[] = []) => buildingInspectorModel({
  view: selected, contentLocations, nodes: [], linkingEntrance, can: canWith(permissions), actions: buildingActions,
});
const buttonNames = () => screen.getAllByRole("button").map((button) => button.textContent);

describe("Building inspector", () => {
  it("offers every action exactly once to an administrator with every switch on", () => {
    const model = buildingModel(allPermissions());
    // No sticky footer: Reshape Footprint is a building-level edit beside Edit Details, and Delete is set apart.
    expect(model.primaryAction).toBeUndefined();
    expect(labels(model)).toEqual(["✎ Edit Details", "▱ Reshape Footprint", "🗑 Delete Building"]);
    expect(model.overflowActions.map((action) => action.separatorBefore ?? false)).toEqual([false, false, true]);

    renderDetails(model);
    const names = buttonNames().filter((name): name is string => Boolean(name));
    const all = [...labels(model), ...names];
    for (const action of ["＋ Add entrance", "↔ Link existing entrance", "＋ Add indoor location", "⌂ Mark indoor location", "✎ Edit Details", "▱ Reshape Footprint"]) {
      expect(all.filter((name) => name === action), action).toHaveLength(1);
    }
    // Entrance actions live only in the access block, indoor actions only in the indoor section.
    expect(within(screen.getByRole("region", { name: "Walking access" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["＋ Add entrance", "↔ Link existing entrance"]);
    expect(within(screen.getByRole("region", { name: "Indoor locations" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(expect.arrayContaining(["＋ Add indoor location", "⌂ Mark indoor location"]));
  });

  it("is read-only for a view-only administrator: no overflow actions, no mutation buttons, but the explanation and a View only note", () => {
    const model = buildingModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.overflowActions).toEqual([]);

    renderDetails(model);
    // The only buttons left are disclosures; none of them acts on the building.
    expect(buttonNames()).toEqual(["▾Indoor locations· 0", "▸Details"]);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByText("Not routable")).toBeInTheDocument();
    expect(screen.getByText("No active entrance is linked to this building, so routes cannot reach it.")).toBeInTheDocument();
  });

  it("maps each switch to its own actions", () => {
    expect(labels(buildingModel(only("add")))).toEqual([]);
    expect(labels(buildingModel(only("edit")))).toEqual(["✎ Edit Details", "▱ Reshape Footprint"]);
    expect(labels(buildingModel(only("delete")))).toEqual(["🗑 Delete Building"]);
    expect(buildingModel(only("changeUserStatus")).overflowActions).toEqual([]);

    renderDetails(buildingModel(only("add")));
    expect(buttonNames()).toEqual(expect.arrayContaining(["＋ Add entrance", "＋ Add indoor location", "⌂ Mark indoor location"]));
    expect(screen.queryByRole("button", { name: "↔ Link existing entrance" })).not.toBeInTheDocument();
  });

  it("makes Add entrance the single solid primary action while the building is not routable and the user may add", () => {
    renderDetails(buildingModel(only("add")));
    const primaries = document.querySelectorAll(".inspector-primary-action");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent("＋ Add entrance");
  });

  it("offers no solid primary action when the building is routable, or when the user may not add", () => {
    const routable: SelectedBuildingView = { ...view, entrances: [{ id: "n1", name: "Gate", nodeType: "Entrance", associatedPlaceId: "b1", lat: 1, lng: 1, status: "Active" }], routable: true };
    const { unmount } = renderDetails(buildingModel(allPermissions(), false, routable));
    expect(document.querySelector(".inspector-primary-action")).toBeNull();
    expect(screen.getByRole("button", { name: "＋ Add entrance" })).toBeInTheDocument();
    expect(screen.getByText("Routes can reach this building through 1 active entrance.")).toBeInTheDocument();
    unmount();

    renderDetails(buildingModel(only("edit")));
    expect(document.querySelector(".inspector-primary-action")).toBeNull();
    expect(screen.queryByRole("button", { name: "＋ Add entrance" })).not.toBeInTheDocument();
  });

  it.each([
    ["no footprint", { ...view, building: { ...building, points: [[1, 1], [1, 2]] as [number, number][] } }, "The building has no footprint geometry, so routes cannot reach it."],
    ["inactive", { ...view, building: { ...building, status: "Inactive" as const } }, "The building is inactive, so routes do not reach it."],
    ["no entrance", view, "No active entrance is linked to this building, so routes cannot reach it."],
    ["only unusable entrances", { ...view, entrances: [{ id: "n1", name: "Gate", nodeType: "Entrance" as const, associatedPlaceId: "b1", lat: 1, lng: 1, status: "Inactive" as const }] }, "The linked entrances are inactive or have no valid coordinates, so routes cannot reach this building."],
  ])("explains why a building is not routable: %s", (_name, selected, sentence) => {
    renderDetails(buildingModel(viewOnlyPermissions(), false, selected));
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("collapses a populated indoor section behind one heading with the count and shows types with icons", () => {
    const rooms: Location[] = [
      { id: "r1", name: "Computer Laboratory 1", code: "CL1", type: "Laboratory", parentId: "b1", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false },
      { id: "r2", name: "Restroom", code: "RR", type: "Restroom", parentId: "b1", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false },
    ];
    renderDetails(buildingModel(allPermissions(), false, view, rooms));
    const toggle = screen.getByRole("button", { name: "Indoor locations · 2" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Computer Laboratory 1")).not.toBeInTheDocument();
    // The contextual actions stay available while the list is collapsed.
    expect(screen.getByRole("button", { name: "＋ Add indoor location" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const floor = screen.getByRole("button", { name: "2nd Floor 2" });
    expect(floor).toHaveAttribute("aria-expanded", "true");
    expect(floor).toHaveAttribute("aria-controls");
    expect(screen.getByText("Laboratory · CL1")).toBeInTheDocument();
    expect(screen.getByText("Restroom · RR")).toBeInTheDocument();
    expect(document.querySelectorAll(".inspector-content-icon svg")).toHaveLength(2);
    fireEvent.click(floor);
    expect(floor).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Computer Laboratory 1")).not.toBeInTheDocument();
  });

  it("states the empty indoor section once for an eligible building and offers Add when permitted", () => {
    renderDetails(buildingModel(allPermissions()));
    expect(screen.getAllByText(/No indoor locations/)).toHaveLength(1);
    expect(screen.queryByText(/0 places/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Add indoor location" })).toBeInTheDocument();
  });

  it("explains that the classification must allow indoor locations first, and offers Edit Details only to someone who may edit", () => {
    const facility: SelectedBuildingView = { ...view, building: { ...building, classification: "Facility" } };
    const { unmount } = renderDetails(buildingModel(allPermissions(), false, facility));
    expect(screen.getByText(/classification must allow indoor locations/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ Add indoor location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⌂ Mark indoor location" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Indoor locations" })).getByRole("button", { name: "✎ Edit Details" })).toBeInTheDocument();
    unmount();

    const unclassified: SelectedBuildingView = { ...view, building: { ...building, classification: undefined } };
    const second = renderDetails(buildingModel(only("add"), false, unclassified));
    expect(screen.getByText(/This building has no classification\./)).toBeInTheDocument();
    expect(screen.getByText(/classification must allow indoor locations/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edit Details" })).not.toBeInTheDocument();
    second.unmount();
  });

  it("doesn't repeat Edit Details in the menu while the indoor section offers it", () => {
    const facility: SelectedBuildingView = { ...view, building: { ...building, classification: "Facility" } };
    expect(labels(buildingModel(allPermissions(), false, facility))).toEqual(["▱ Reshape Footprint", "🗑 Delete Building"]);
    // Rooms in other buildings don't count: this building's own indoor list is still empty.
    const elsewhere = { id: "room-x", name: "Other Room", type: "Room", parentId: "other-building", building: "Other Hall" } as Location;
    expect(labels(buildingModel(allPermissions(), false, facility, [elsewhere]))).toEqual(["▱ Reshape Footprint", "🗑 Delete Building"]);
    expect(labels(buildingModel(allPermissions()))).toContain("✎ Edit Details");
  });

  it("labels the header Building with the campus code or a labelled OSM reference, plus the classification", () => {
    const subtitle = (selected: SelectedBuildingView) => {
      const model = buildingModel(allPermissions(), false, selected);
      expect(model.objectLabel).toBe("Building");
      return render(<>{model.subtitle}</>).container.textContent;
    };
    expect(subtitle(view)).toBe("Code HALL · College");
    expect(subtitle({ ...view, building: { ...building, code: "OSM way 232896095" } })).toBe("OSM way 232896095 · College");
  });

  it("shows the entrance picker only to someone who may edit", () => {
    const { unmount } = renderDetails(buildingModel(only("add"), true));
    expect(screen.queryByText("Select an existing Entrance Route Node")).not.toBeInTheDocument();
    unmount();

    renderDetails(buildingModel(only("edit"), true));
    expect(screen.getByText("Select an existing Entrance Route Node")).toBeInTheDocument();
  });
});

describe("Location inspector", () => {
  const room: Location = { id: "r1", name: "Room 1", code: "R1", type: "Room", parentId: "b1", status: "Active", lat: null, lng: null, positioned: false };
  const locationModel = (permissions: AdminPermissions) => locationInspectorModel({
    location: room, buildings: [building], locations: [room], can: canWith(permissions), onEditDetails: noop,
  });

  it("shows the parent building, floor and an unplaced marker, with lifecycle beside identity", () => {
    const model = locationModel(allPermissions());
    expect(model.objectLabel).toBe("Indoor location");
    expect(render(<>{model.subtitle}</>).container.textContent).toBe("Room · R1 · Active");
    expect(model.summary).toEqual(expect.arrayContaining([
      { label: "Parent building", value: "Hall" }, { label: "Map marker", value: "Not placed" },
    ]));
    expect(model.summary.some((item) => item.label === "Lifecycle")).toBe(false);
  });

  it("shows Placed with coordinates once the location has a marker", () => {
    const placed = { ...room, lat: 1.5, lng: 2.5, positioned: true };
    const model = locationInspectorModel({ location: placed, buildings: [building], locations: [placed], can: canWith(allPermissions()), onEditDetails: noop });
    expect(model.summary).toEqual(expect.arrayContaining([{ label: "Map marker", value: "Placed" }, { label: "Coordinates", value: "1.500000, 2.500000" }]));
  });

  it("resolves the parent as a Place, never by a bare id shared with another Location type", () => {
    const impostor: Location = { id: "b1", name: "Not a place", code: "X", type: "Office", parentId: null, status: "Active", lat: null, lng: null, positioned: false };
    const model = locationInspectorModel({ location: room, buildings: [], locations: [impostor, room], can: canWith(allPermissions()), onEditDetails: noop });
    expect(model.summary).toEqual(expect.arrayContaining([{ label: "Parent building", value: "—" }]));
  });

  it("says View only to someone who may not edit", () => {
    expect(locationModel(viewOnlyPermissions()).viewOnly).toBe(true);
    expect(locationModel(allPermissions()).viewOnly).toBe(false);
  });

  it("offers Edit Details with the Edit switch only", () => {
    expect(labels(locationModel(allPermissions()))).toEqual(["✎ Edit Details"]);
    expect(labels(locationModel(only("edit")))).toEqual(["✎ Edit Details"]);
    expect(locationModel(only("add")).overflowActions).toEqual([]);
    expect(locationModel(viewOnlyPermissions()).overflowActions).toEqual([]);
  });
});

describe("Route Node inspector", () => {
  const node: RouteNode = { id: "n1", name: "Gate", nodeType: "Entrance", associatedPlaceId: "b1", lat: 1, lng: 1, status: "Active" };
  const nodeModel = (permissions: AdminPermissions) => routeNodeInspectorModel({
    node,
    can: canWith(permissions),
    frame: { frame: null, dirty: false, stage: noop, cancel: noop, apply: noop, load: noop } as never,
    workflow: {} as never,
    nodes: [node], pathways: [], buildings: [building], locations: [], campusBoundary: [], buildingAssociationOptions: [building],
    savingAction: null, onError: noop, onNodeUpdated: noop, onMove: noop, onDelete: noop,
  });

  it("offers move, metadata, conversion and delete to a full administrator", () => {
    const model = nodeModel(allPermissions());
    expect(model.primaryAction?.label).toBe("✥ Move Entrance");
    expect(labels(model)).toEqual(["⎋ Convert to Junction", "🗑 Delete Route Node"]);
    expect(model.overflowActions.map((action) => action.separatorBefore ?? false)).toEqual([false, true]);
    expect(model.objectLabel).toBe("Entrance");
    renderDetails(model);
    expect(screen.getByRole("button", { name: "Update Route Node" })).toBeInTheDocument();
  });

  it("shows a view-only administrator the summary alone", () => {
    const model = nodeModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.details).toBeUndefined();
    expect(model.overflowActions).toEqual([]);
    expect(model.viewOnly).toBe(true);
    expect(nodeModel(allPermissions()).viewOnly).toBe(false);
  });

  it("labels a Junction Route node and puts its type and lifecycle in the header", () => {
    const junction = { ...node, nodeType: "Junction" as const, associatedPlaceId: null };
    const model = routeNodeInspectorModel({
      node: junction, can: canWith(allPermissions()), frame: { frame: null, dirty: false } as never, workflow: {} as never,
      nodes: [junction], pathways: [], buildings: [], locations: [], campusBoundary: [], buildingAssociationOptions: [],
      savingAction: null, onError: noop, onNodeUpdated: noop, onMove: noop, onDelete: noop,
    });
    expect(model.objectLabel).toBe("Route node");
    expect(model.subtitle).toBe("Junction · Active");
    expect(model.summary.map((item) => item.label)).toEqual(["Connected Pathways", "Coordinates"]);
  });

  it("keeps Cancel neutral beside Update: only Update carries the primary class", () => {
    renderDetails(nodeModel(allPermissions()));
    expect(screen.getByRole("button", { name: "Update Route Node" })).toHaveClass("inspector-primary-action");
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveClass("inspector-primary-action");
  });

  it("leaves only Delete with the Delete switch, and moving and metadata with the Edit switch", () => {
    expect(labels(nodeModel(only("delete")))).toEqual(["🗑 Delete Route Node"]);
    expect(nodeModel(only("delete")).primaryAction).toBeUndefined();
    const editing = nodeModel(only("edit"));
    expect(editing.primaryAction?.label).toBe("✥ Move Entrance");
    expect(editing.details).toBeDefined();
    expect(labels(editing)).toEqual(["⎋ Convert to Junction"]);
  });
});

describe("Pathway inspector", () => {
  const path = { id: "p1", name: "Walk", sourceNodeId: "a", destinationNodeId: "b", direction: "Two-way", status: "Active", shade: "Mostly Shaded", type: "Walkway", allowedModes: ["Walking"], pathPoints: [] } as unknown as Pathway;
  const editor = (overrides: Record<string, unknown> = {}) => ({
    currentPathways: [path], pathwayFrame: { ...path }, pathwayFrameIssues: [], pathwayFrameDirty: false,
    setPathwayDraft: noop, adoptSuggestedPathwayName: noop, switchEndpoints: noop, ...overrides,
  } as never);
  const pathwayModel = (permissions: AdminPermissions) => selectedPathwayInspectorModel({
    pathway: editor(),
    path, nodes: [], buildings: [], savingAction: null, can: canWith(permissions),
    onSelect: noop, onApply: noop, onCancel: noop, onReshape: noop, onDelete: noop,
  });

  it("offers update, cancel, reshape and delete once each to a full administrator", () => {
    const model = pathwayModel(allPermissions());
    expect(model.primaryAction?.label).toBe("Update Pathway");
    // Cancel and Reshape live in the card body; the menu holds only Delete, set apart.
    expect(labels(model)).toEqual(["🗑 Delete Pathway"]);
    expect(model.overflowActions[0].separatorBefore).toBe(true);
    renderDetails(model);
    expect(screen.getAllByRole("button", { name: "⌁ Reshape Pathway" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(model.objectLabel).toBe("Pathway");
    expect(model.subtitle).toBe("Two-way · Active");
  });

  it("shows type, shade and allowed modes as read-only facts to a view-only administrator", () => {
    const model = pathwayModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.details).toBeUndefined();
    expect(model.overflowActions).toEqual([]);
    expect(model.viewOnly).toBe(true);
    expect(model.summary).toEqual(expect.arrayContaining([
      { label: "Way type", value: "Walkway" }, { label: "Shade", value: "Mostly Shaded" }, { label: "Allowed modes", value: "Walking" },
    ]));
    // Someone who may edit reads these in the inputs instead.
    expect(pathwayModel(allPermissions()).summary.map((item) => item.label)).toEqual(["Source Route Node", "Destination Route Node"]);
  });

  it("explains the disabled Vehicle checkbox on a Walkway", () => {
    renderDetails(pathwayModel(allPermissions()));
    const vehicle = screen.getByRole("checkbox", { name: "Vehicle" });
    expect(vehicle).toBeDisabled();
    expect(vehicle).toHaveAccessibleDescription("Walkways allow walking only.");
  });

  it("splits Edit and Delete", () => {
    expect(labels(pathwayModel(only("edit")))).toEqual([]);
    expect(labels(pathwayModel(only("delete")))).toEqual(["🗑 Delete Pathway"]);
    expect(pathwayModel(only("edit")).primaryAction?.label).toBe("Update Pathway");
  });
});

describe("Path Point inspector", () => {
  const parent = { id: "p1", name: "Walk", sourceNodeId: "a", destinationNodeId: "b", direction: "Two-way", status: "Active", shade: "Unshaded", type: "Walkway", pathPoints: [[1, 1]] } as unknown as Pathway;
  const pointModel = (permissions: AdminPermissions) => pathPointInspectorModel({
    pathway: {
      activePathway: parent, pathwayFrame: { ...parent }, pathwayFrameIssues: [], pathwayFrameDirty: false, editingPathId: "p1",
      setPathwayDraft: noop, pathPoints: [[1, 1]], setPathPoints: noop, selectedPathPointIndex: 0, setSelectedPathPointIndex: noop,
      pathDraftDirty: false, setPathDraftDirty: noop, canModify: true,
    } as never,
    id: "p1:point:0", nodes: [], savingAction: null, can: canWith(permissions), onSelect: noop, onApply: noop, onCancel: noop, onStartConversion: noop,
  })!;

  it("offers the parent status exactly as the Pathway card does: Active and Closed, showing Active for an Active parent", () => {
    renderDetails(pointModel(allPermissions()));
    const select = screen.getByRole("combobox", { name: "Pathway status" });
    expect(select).toHaveValue("Active");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Active", "Closed"]);
    cleanup();
    renderDetails(selectedPathwayInspectorModel({
      pathway: { currentPathways: [parent], pathwayFrame: { ...parent }, pathwayFrameIssues: [], pathwayFrameDirty: false, setPathwayDraft: noop, adoptSuggestedPathwayName: noop, switchEndpoints: noop } as never,
      path: parent, nodes: [], buildings: [], savingAction: null, can: canWith(allPermissions()), onSelect: noop, onApply: noop, onCancel: noop, onReshape: noop, onDelete: noop,
    }));
    const pathwaySelect = screen.getByRole("combobox", { name: "Pathway status" });
    expect(pathwaySelect).toHaveValue("Active");
    expect(within(pathwaySelect).getAllByRole("option").map((option) => option.textContent)).toEqual(["Active", "Closed"]);
  });

  it("repeats neither Update nor Cancel in the menu, and sets Remove apart", () => {
    const model = pointModel(allPermissions());
    expect(model.primaryAction?.label).toBe("Update Pathway");
    expect(labels(model)).toEqual(["Convert to Route Node", "↩ Inspect Parent Pathway", "🗑 Remove Path Point"]);
    expect(model.overflowActions.map((action) => action.separatorBefore ?? false)).toEqual([false, false, true]);
    expect(model.objectLabel).toBe("Path point");
    expect(model.subtitle).toBe("Point 1 of 1 · Walk");
  });

  it("reads View only when the administrator may neither edit nor add", () => {
    expect(pointModel(viewOnlyPermissions()).viewOnly).toBe(true);
    expect(pointModel(allPermissions()).viewOnly).toBe(false);
  });
});
