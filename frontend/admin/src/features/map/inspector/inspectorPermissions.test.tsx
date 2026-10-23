import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { allPermissions, canPerform, viewOnlyPermissions } from "../../../lib/permissions";
import type { AdminPermissions, Building, Location, Pathway, RouteNode } from "../../../types";
import { buildingInspectorModel } from "../building/buildingInspectorModel";
import type { SelectedBuildingView } from "../building/selectedBuilding";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { locationInspectorModel } from "../location/locationInspectorModel";
import { selectedPathwayInspectorModel } from "../pathway/pathwayInspectorModel";
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
  onToggleLinkEntrance: noop, onLinkExistingEntrance: noop, onLinkEntrance: noop, onDelete: noop,
};
const buildingModel = (permissions: AdminPermissions, linkingEntrance = false) => buildingInspectorModel({
  view, contentLocations: [], nodes: [], linkingEntrance, can: canWith(permissions), actions: buildingActions,
});

describe("Building inspector", () => {
  it("offers everything to an administrator with every switch on", () => {
    const model = buildingModel(allPermissions());
    expect(model.primaryAction?.label).toBe("▱ Reshape Footprint");
    expect(labels(model)).toEqual([
      "✎ Edit Details", "＋ Add indoor location", "⌂ Mark indoor location", "＋ Add entrance", "↔ Link existing entrance", "🗑 Delete Building",
    ]);
  });

  it("is read-only for a view-only administrator: no primary action, no overflow actions, no buttons in the body", () => {
    const model = buildingModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.overflowActions).toEqual([]);

    renderDetails(model);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Indoor locations by floor")).toBeInTheDocument();
    expect(screen.getByText("Entrance route nodes")).toBeInTheDocument();
  });

  it("maps each switch to its own actions", () => {
    expect(labels(buildingModel(only("add")))).toEqual(["＋ Add indoor location", "⌂ Mark indoor location", "＋ Add entrance"]);
    expect(labels(buildingModel(only("edit")))).toEqual(["✎ Edit Details", "↔ Link existing entrance"]);
    expect(buildingModel(only("edit")).primaryAction?.label).toBe("▱ Reshape Footprint");
    expect(labels(buildingModel(only("delete")))).toEqual(["🗑 Delete Building"]);
    expect(buildingModel(only("changeUserStatus")).overflowActions).toEqual([]);
  });

  it("splits the body's entrance buttons between Add and Edit", () => {
    renderDetails(buildingModel(only("add")));
    expect(screen.getByRole("button", { name: "＋ Add indoor location" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Add entrance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "↔ Link existing entrance" })).not.toBeInTheDocument();
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
    expect(labels(model)).toEqual(["⎋ Convert to Standard Node", "🗑 Delete Route Node"]);
    renderDetails(model);
    expect(screen.getByRole("button", { name: "Update Route Node" })).toBeInTheDocument();
  });

  it("shows a view-only administrator the summary alone", () => {
    const model = nodeModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.details).toBeUndefined();
    expect(model.overflowActions).toEqual([]);
  });

  it("leaves only Delete with the Delete switch, and moving and metadata with the Edit switch", () => {
    expect(labels(nodeModel(only("delete")))).toEqual(["🗑 Delete Route Node"]);
    expect(nodeModel(only("delete")).primaryAction).toBeUndefined();
    const editing = nodeModel(only("edit"));
    expect(editing.primaryAction?.label).toBe("✥ Move Entrance");
    expect(editing.details).toBeDefined();
    expect(labels(editing)).toEqual(["⎋ Convert to Standard Node"]);
  });
});

describe("Pathway inspector", () => {
  const path = { id: "p1", name: "Walk", sourceNodeId: "a", destinationNodeId: "b", direction: "Two-way", status: "Active", pathPoints: [] } as unknown as Pathway;
  const pathwayModel = (permissions: AdminPermissions) => selectedPathwayInspectorModel({
    pathway: {
      currentPathways: [path], pathwayFrame: null, pathwayFrameIssues: [], pathwayFrameDirty: false,
      setPathwayDraft: noop, adoptSuggestedPathwayName: noop, switchEndpoints: noop,
    } as never,
    path, nodes: [], buildings: [], savingAction: null, can: canWith(permissions),
    onSelect: noop, onApply: noop, onCancel: noop, onReshape: noop, onDelete: noop,
  });

  it("offers update, cancel, reshape and delete to a full administrator", () => {
    const model = pathwayModel(allPermissions());
    expect(model.primaryAction?.label).toBe("Update Pathway");
    expect(labels(model)).toEqual(["Cancel changes", "⌁ Reshape Pathway", "🗑 Delete Pathway"]);
    renderDetails(model);
    expect(screen.getByRole("button", { name: "⌁ Reshape Pathway" })).toBeInTheDocument();
  });

  it("is read-only for a view-only administrator", () => {
    const model = pathwayModel(viewOnlyPermissions());
    expect(model.primaryAction).toBeUndefined();
    expect(model.details).toBeUndefined();
    expect(model.overflowActions).toEqual([]);
  });

  it("splits Edit and Delete", () => {
    expect(labels(pathwayModel(only("edit")))).toEqual(["Cancel changes", "⌁ Reshape Pathway"]);
    expect(labels(pathwayModel(only("delete")))).toEqual(["🗑 Delete Pathway"]);
  });
});
