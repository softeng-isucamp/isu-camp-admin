import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { generatedMapFixture } from "../../../services/generatedMapFixture";
import type { RouteNode } from "../../../types";
import { useMapEditorTestLifecycle, renderEditor, clickMap, confirmDeletePassword } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("uses the point command only for Route Node creation", async () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: "Outdoor Point Location" })).not.toBeInTheDocument();
    const routeNodeTool = await screen.findByRole("button", { name: "Route Node" });
    fireEvent.click(routeNodeTool);
    clickMap(16.7208, 121.6902);

    expect(screen.getByRole("heading", { name: "Place Route Node" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Place Outdoor Point Location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create Outdoor Point Location" })).not.toBeInTheDocument();
  });

  it("moves an imported route node from the generated fixture", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue(generatedMapFixture.buildings);
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    const importedNode = generatedMapFixture.nodes[0];
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: importedNode.name } });
    fireEvent.click(await screen.findByRole("button", { name: `${importedNode.name} Route Node` }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: importedNode.id,
      lat: 16.7214,
      lng: 121.6908,
    })));
  });

  it("persists a newly added Route Node's moved position", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Ramp" } });
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    await waitFor(() => expect(services.map.createRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Ramp",
      lat: 16.7208,
      lng: 121.6902,
    })));
    expect(await screen.findByRole("complementary", { name: "New Ramp object details" })).toBeInTheDocument();
  });

  it("prevents duplicate Route Node saves while the request is in flight", async () => {
    let resolveCreate: ((node: RouteNode) => void) | undefined;
    vi.mocked(services.map.createRouteNode).mockClear();
    vi.mocked(services.map.createRouteNode).mockImplementation((node) => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Ramp" } });
    clickMap(16.7208, 121.6902);

    const saveButton = screen.getByRole("button", { name: "Save Route Node" });
    fireEvent.click(saveButton);
    expect(await screen.findByRole("button", { name: "Saving Route Node…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Saving Route Node…" }));

    expect(services.map.createRouteNode).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCreate?.({ id: "created-node", name: "New Ramp", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7208, lng: 121.6902 });
    });
    expect(await screen.findByRole("complementary", { name: "New Ramp object details" })).toBeInTheDocument();
  });

  it("persists a seeded Route Node's moved position", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));
    clickMap(16.7214, 121.6908);
    fireEvent.click(screen.getByRole("button", { name: "Save Position" }));

    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: "node-a",
      lat: 16.7214,
      lng: 121.6908,
    })));
    await waitFor(() => expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7214,121.6908"]')).toBeTruthy());
  });

  it("shows the move distance and outside-campus feedback until the move is cancelled", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: /Move (Entrance|Route Node)/ }));

    const panel = screen.getByRole("region", { name: "Move North Entrance" });
    expect(panel).toHaveTextContent("Δ 0.0m");
    expect(panel).not.toHaveClass("outside-boundary");
    expect(screen.getByTestId("point-move-tether-badge")).toHaveTextContent("Δ 0.0m");
    expect(screen.getByTestId("point-move-tether")).toHaveAttribute("data-color", "#005931");

    clickMap(16.7214, 121.6908);
    expect(screen.getByTestId("point-move-tether-badge")).not.toHaveTextContent("Δ 0.0m");
    expect(screen.getByTestId("point-move-tether")).toHaveAttribute("data-color", "#005931");

    fireEvent.change(screen.getByLabelText("Move latitude"), { target: { value: "16.7100" } });
    expect(screen.getByTestId("point-move-tether")).toHaveAttribute("data-color", "#b42318");
    expect(panel).toHaveClass("outside-boundary");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("point-move-tether")).not.toBeInTheDocument();
  });

  it("records Route Node inspector edits and clears an Entrance association when changing type", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "loc-1", lat: 16.7205, lng: 121.6895 },
    ]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Building", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Entrance Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node name"), { target: { value: "North Gate" } });
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Junction" } });

    expect(screen.getByLabelText("Route Node name")).toHaveValue("North Gate");
    expect(screen.queryByLabelText("Route Node association")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Route Node" }));
    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: "node-a",
      name: "North Gate",
      nodeType: "Junction",
      associatedPlaceId: null,
    })));
    expect(screen.getByRole("complementary", { name: "North Gate object details" })).toHaveTextContent("Junction Route Node");
  });

  it("persists converting an Entrance to a Junction and restores truthful UI when persistence fails", async () => {
    const updateRouteNode = vi.fn(async () => {
      throw new Error("Route Node update failed");
    });
    services.map.updateRouteNode = updateRouteNode;
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: "building-1", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Entrance Route Node" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for North Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "⎋ Convert to Standard Node" }));

    await waitFor(() => expect(updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: "node-a", nodeType: "Junction", associatedPlaceId: null,
    })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Route Node update failed");
    expect(screen.getByRole("complementary", { name: "North Entrance object details" })).toHaveTextContent("Entrance Route Node");
  });

  it("shows canonical Buildings for an Entrance association without persisting the selection", async () => {
    vi.mocked(services.map.save).mockClear();
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "map-only-building", name: "Unregistered Map Shape", code: "MAP-ONLY", points: [] },
    ]);
    vi.mocked(services.locations.list).mockResolvedValue({
      items: [{ id: "building-42", name: "Engineering Hall", code: "ENG-01", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));

    const association = await screen.findByLabelText("Route Node association");
    expect(association).toHaveDisplayValue("No Building association");
    expect(within(association).getByRole("option", { name: "Engineering Hall (ENG-01)" })).toBeInTheDocument();
    expect(within(association).getByRole("option", { name: "Unregistered Map Shape (MAP-ONLY)" })).toBeInTheDocument();
    fireEvent.change(association, { target: { value: "building-42" } });

    expect(association).toHaveValue("building-42");
    expect(services.map.save).not.toHaveBeenCalled();
  });

  it("deletes a Route Node only after confirmation and retains the dialog after failure", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-entrance", destinationNodeId: "node-junction", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-entrance", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895, status: "Active" },
      { id: "node-junction", name: "Main Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.690, status: "Active" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Entrance" }));
    vi.mocked(services.map.deleteRouteNode).mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Delete Route Node" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Library Walk");
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete Route Node" }));
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent("network unavailable"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete Route Node" }));
    await waitFor(() => expect(services.map.deleteRouteNode).toHaveBeenCalledTimes(2));
  });

  it("places an Entrance by map click and allows its coordinates to be edited manually", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Entrance" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "Science Annex Entrance" } });
    clickMap(16.7208, 121.6902);

    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    await waitFor(() => expect(services.map.createRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      name: "Science Annex Entrance",
      nodeType: "Entrance",
      lat: 16.7208,
      lng: 121.6902,
    })));
    await waitFor(() => expect(document.querySelector('[data-testid="saved-map-marker"][data-position="16.7208,121.6902"]')).toBeTruthy());
  });

  it("allows metadata edits immediately after creating a Route Node", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Route Node" }));
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Access Point" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. CAS Entrance"), { target: { value: "New Access Point" } });
    clickMap(16.7208, 121.6902);
    fireEvent.click(screen.getByRole("button", { name: "Save Route Node" }));

    await waitFor(() => expect(screen.getByLabelText("Route Node name")).toHaveValue("New Access Point"));
    fireEvent.change(screen.getByLabelText("Route Node name"), { target: { value: "Updated Access Point" } });
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Junction" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Route Node" }));

    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: "created-node",
      name: "Updated Access Point",
      nodeType: "Junction",
    })));
  });
});
