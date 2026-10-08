import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { generatedMapFixture } from "../../../services/generatedMapFixture";
import { useMapEditorTestLifecycle, renderEditor, choosePathwayEditor, chooseWalkingNetworkBrowser, confirmDeletePassword, mapTestState } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("offers mutually exclusive browsing and Pathway editing choices", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
    const choices = screen.getByRole("menu", { name: "Pathway options" });
    expect(within(choices).getByRole("menuitem", { name: "Browse Walking Network" })).toBeInTheDocument();
    expect(within(choices).getByRole("menuitem", { name: "Create or edit Pathway" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Walking Network browser" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Calibrate Path Points" })).not.toBeInTheDocument();

    fireEvent.click(within(choices).getByRole("menuitem", { name: "Browse Walking Network" }));
    const browser = screen.getByRole("complementary", { name: "Walking Network browser" });
    expect(browser).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Calibrate Path Points" })).not.toBeInTheDocument();

    fireEvent.click(within(browser).getByRole("button", { name: /Library Walk/ }));
    expect(screen.queryByRole("complementary", { name: "Library Walk object details" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pathway" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create or edit Pathway" }));
    expect(screen.queryByRole("complementary", { name: "Walking Network browser" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Calibrate Path Points" })).toBeInTheDocument();
  });

  it("keeps Walking Network browser selection synchronized with the map", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    await chooseWalkingNetworkBrowser();
    const pathwayResult = await screen.findByRole("button", { name: /Library Walk/ });
    fireEvent.click(pathwayResult);
    expect(pathwayResult).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-color", "#e67e22");

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const nodeMarker = screen.getAllByTestId("saved-map-marker").find((marker) =>
      marker.getAttribute("data-icon-class")?.includes("route-node-icon") && marker.getAttribute("data-position") === "16.7205,121.6895",
    );
    fireEvent.click(nodeMarker!);
    const overlapChoice = await screen.findByRole("button", { name: "Select North Entrance Route Node" });
    fireEvent.click(overlapChoice);

    expect(screen.getByRole("tab", { name: "Route Nodes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: /North Entrance/ }).find((button) =>
      button.hasAttribute("aria-pressed"),
    )).toHaveAttribute("aria-pressed", "true");
  });

  it("edits an imported pathway from the generated fixture", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: generatedMapFixture.pathways[0].name } });
    fireEvent.click((await screen.findAllByRole("button", { name: `${generatedMapFixture.pathways[0].name} Pathway` }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "⌁ Reshape Pathway" }));
    const importedPoint = generatedMapFixture.pathways[0].pathPoints[0];
    fireEvent.click((await screen.findAllByRole("button", { name: `Path Point at ${importedPoint.join(",")}` }))[0]);
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.72095" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.6895" } });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Update Pathway" }));

    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({ id: generatedMapFixture.pathways[0].id })));
  });

  it("lets Reshape Pathway drag a point immediately without calculating distance or ETA", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-unknown-distance", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    vi.mocked(services.map.updatePathway).mockClear();

    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click((await screen.findAllByRole("button", { name: /North Walk/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "⌁ Reshape Pathway" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Path Point at 16.7207,121.6897" }))[0]);

    expect(screen.getByTestId("path-point-marker")).toHaveAttribute("data-draggable", "true");
    expect(screen.queryByRole("button", { name: "✥ Drag Path Point" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Update Pathway" }));

    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({
      pathPoints: [[16.7209, 121.6897]],
    })));
    expect(services.map.updatePathway).not.toHaveBeenCalledWith(expect.objectContaining({ distance: expect.anything() }));
    expect(services.map.updatePathway).not.toHaveBeenCalledWith(expect.objectContaining({ time: expect.anything() }));
  });

  it("allows a geometry-only Pathway to save without distance validation", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-zero-length", name: "Zero Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    vi.mocked(services.map.updatePathway).mockClear();

    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click((await screen.findAllByRole("button", { name: /Zero Walk/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "⌁ Reshape Pathway" }));

    const updateButton = screen.getAllByRole("button", { name: "Update Pathway" })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(updateButton).toBeDefined();
    fireEvent.click(updateButton!);

    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalled());
  });

  it("confirms, cancels, and hard-deletes a Pathway with its Path Point warning", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([
      { id: "building-lib", name: "Library", code: "LIB", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-entrance", name: "Library Entrance", nodeType: "Entrance", associatedPlaceId: "building-lib", lat: 16.7205, lng: 121.6895, status: "Active" },
      { id: "node-junction", name: "Main Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.690, status: "Active" },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-library", name: "Library Walk", sourceNodeId: "node-entrance", destinationNodeId: "node-junction", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Walk Pathway/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Walk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Delete Pathway" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("1 Path Point");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(services.map.deletePathway).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Library Walk" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "🗑 Delete Pathway" }));
    confirmDeletePassword();
    fireEvent.click(screen.getByRole("button", { name: "Delete Pathway" }));
    await waitFor(() => expect(services.map.deletePathway).toHaveBeenCalledWith("path-library"));
  });

  it("browses an Active Pathway and applies its metadata from the unified card", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "active-path", name: "Active Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Active", allowedModes: ["Walking"], pathPoints: [] },
    ]);
    renderEditor();

    await chooseWalkingNetworkBrowser();
    fireEvent.change(screen.getByPlaceholderText("Search Pathways"), { target: { value: "Active Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: /Active Walk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Walking Network browser" }));

    expect(screen.getByRole("complementary", { name: "Active Walk object details" })).toBeInTheDocument();
    expect(screen.queryByText("Calibrate Path Points")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✎ Edit Pathway" })).not.toBeInTheDocument();
    expect(Array.from((screen.getByLabelText("Pathway type") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["Walkway", "Road"]);
    expect(screen.getByRole("checkbox", { name: "Vehicle" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Pathway name" }), { target: { value: "Renamed Active Walk" } });

    const apply = screen.getByRole("button", { name: "Update Pathway" });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({
      id: "active-path",
      name: "Renamed Active Walk",
    })));
    expect(screen.getByRole("complementary", { name: "Renamed Active Walk object details" })).toBeInTheDocument();
  });

  it("adjusts a selected Path Point with coordinates", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.change(screen.getByLabelText("Path Point longitude"), { target: { value: "121.6899" } });
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6899],[16.721,121.69]]");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Update Pathway" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6899],[16.721,121.69]]");
  });

  it("moves a selected Path Point immediately while reshaping", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    const point = await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" });
    fireEvent.click(point);
    expect(point).toHaveAttribute("data-draggable", "true");
    const draggablePoint = screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" });
    const iconIdBeforeDrag = draggablePoint.getAttribute("data-icon-id");
    expect(draggablePoint).toHaveAttribute("data-icon-size", "30,30");
    mapTestState.pathPointDragPosition = { lat: 16.7208, lng: 121.6898 };
    fireEvent.drag(draggablePoint);
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7208,121.6898],[16.721,121.69]]");
    expect(screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" })).toHaveAttribute("data-icon-id", iconIdBeforeDrag);
    fireEvent.dragEnd(screen.getByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7208,121.6898],[16.721,121.69]]");
  });

  it("converts a saved Path Point after metadata entry and saves both replacement Pathways together", async () => {
    vi.mocked(services.map.createRouteNode).mockClear();
    vi.mocked(services.map.createPathway).mockClear();
    vi.mocked(services.map.pathways).mockResolvedValue([{
      id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway",
      direction: "Two-way", status: "Open", allowedModes: ["Walking"],
      pathPoints: [[16.7207, 121.6897], [16.7208, 121.6898]],
    }]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert to Route Node" }));

    const dialog = screen.getByRole("dialog", { name: "Convert Path Point to Route Node" });
    expect(services.map.convertPathPoint).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Replacement Pathway A way type")).toHaveValue("Walkway");
    expect(within(dialog).getByLabelText("Replacement Pathway B shade")).toHaveValue("Mostly Shaded");
    expect(within(dialog).getByLabelText("Converted Route Node name")).toHaveValue("Junction near North Entrance");
    expect(within(dialog).getByLabelText("Converted Route Node type")).toHaveTextContent("Entrance");
    fireEvent.change(within(dialog).getByLabelText("Converted Route Node name"), { target: { value: "Library Junction" } });
    fireEvent.change(within(dialog).getByLabelText("Replacement Pathway B way type"), { target: { value: "Road" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Route Node and Pathways" }));

    await waitFor(() => expect(services.map.convertPathPoint).toHaveBeenCalledWith(expect.objectContaining({
      pathwayId: "path-1", sequenceNo: 1, point: [16.7207, 121.6897],
      node: expect.objectContaining({ name: "Library Junction", nodeType: "Junction" }),
      pathways: [expect.objectContaining({ name: "North Walk A", pathPoints: [] }),
        expect.objectContaining({ name: "North Walk B", type: "Road", pathPoints: [[16.7208, 121.6898]] })],
    })));
    expect(services.map.createRouteNode).not.toHaveBeenCalled();
    expect(services.map.createPathway).not.toHaveBeenCalled();
  });

  it("reuses a Route Node already at the selected Path Point", async () => {
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", lat: 16.721, lng: 121.69 },
      { id: "node-middle", name: "Existing Junction", nodeType: "Junction", lat: 16.7207, lng: 121.6897 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([{
      id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway",
      direction: "Two-way", status: "Open", allowedModes: ["Walking"], pathPoints: [[16.7207, 121.6897]],
    }]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert to Route Node" }));

    const dialog = screen.getByRole("dialog", { name: "Convert Path Point to Route Node" });
    expect(within(dialog).getByText("Existing Junction")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Converted Route Node name")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Route Node and Pathways" }));
    await waitFor(() => expect(services.map.convertPathPoint).toHaveBeenCalledWith(expect.objectContaining({
      existingNodeId: "node-middle", node: null,
    })));
  });

  it("applies Parent Pathway metadata and selected Path Point geometry as one draft", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897], [16.7208, 121.6898]] },
    ]);
    renderEditor();

    await screen.findByTestId("path-geometry");
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Walk Pathway" }));
    fireEvent.change(screen.getByLabelText("Pathway shade"), { target: { value: "Fully Shaded" } });
    fireEvent.change(screen.getByLabelText("Pathway direction"), { target: { value: "One-way" } });
    fireEvent.click(await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" }));
    fireEvent.change(screen.getByLabelText("Path Point latitude"), { target: { value: "16.7209" } });
    fireEvent.change(screen.getByLabelText("Pathway shade"), { target: { value: "Unshaded" } });

    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✓ Update Pathway" }));

    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({
      id: "path-1",
      shade: "Unshaded",
      direction: "One-way",
      pathPoints: [[16.7209, 121.6897], [16.7208, 121.6898]],
    })));
    expect(screen.getByLabelText("Pathway shade")).toHaveValue("Unshaded");
    expect(screen.getByText("Unshaded · Walkway · One-way · Open")).toBeInTheDocument();
    expect(screen.getByTestId("path-geometry")).toHaveAttribute("data-positions", "[[16.7205,121.6895],[16.7209,121.6897],[16.7208,121.6898],[16.721,121.69]]");
  });

  it("switches a selected Pathway's endpoints and reverses its Path Sequence", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897], [16.7208, 121.6898]] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Walk Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch source and destination" }));

    const inspector = screen.getByRole("complementary", { name: "North Walk object details" });
    expect(inspector).toHaveTextContent("Source Route NodeSouth Junction");
    expect(inspector).toHaveTextContent("Destination Route NodeNorth Entrance");
    const updateButton = screen.getAllByRole("button", { name: "Update Pathway" })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(updateButton).toBeDefined();
    fireEvent.click(updateButton!);

    await waitFor(() => expect(services.map.updatePathway).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: "node-b",
      destinationNodeId: "node-a",
      pathPoints: [[16.7208, 121.6898], [16.7207, 121.6897]],
    })));
  });

  it("blocks drawing a duplicate direct Pathway in either direction", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    await choosePathwayEditor();
    fireEvent.click(screen.getByRole("button", { name: "＋ New Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Map marker at 16.721,121.69" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Map marker at 16.7205,121.6895" })[1]);

    expect(screen.getByRole("alert")).toHaveTextContent("A direct Pathway already connects these Route Nodes.");
  });

  it("starts a new Pathway with an endpoint name suggestion and constrained Way type", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([]);
    renderEditor();
    await choosePathwayEditor();
    fireEvent.click(screen.getByRole("button", { name: "＋ New Pathway" }));
    fireEvent.click(screen.getByRole("button", { name: "Map marker at 16.721,121.69" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Map marker at 16.7205,121.6895" })[1]);

    const name = screen.getByRole("textbox", { name: "Pathway name" });
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("placeholder", "North Entrance – South Junction");
    expect(Array.from((screen.getByLabelText("Pathway type") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["Walkway", "Road"]);
    expect(
      screen.getAllByRole("checkbox", { name: "Vehicle" })
        .every((checkbox) => (checkbox as HTMLInputElement).disabled),
    ).toBe(true);

    fireEvent.change(name, { target: { value: "New Campus Walk" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Pathway" }));
    await waitFor(() => expect(services.map.createPathway).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Campus Walk",
    })));
  });

  it("adds a midpoint Path Point without creating a Route Node", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByTestId("path-geometry"));
    await choosePathwayEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add Path Point on segment 1" }));

    expect(screen.getByRole("button", { name: /Path Point at 16\.72075.*121\.68975/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map marker at 16.721,121.69" })).toBeInTheDocument();
  });

  it("allows close pathway editing and uses the building-footprint midpoint handle", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "Short Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();
    fireEvent.click(await screen.findByTestId("path-geometry"));
    await choosePathwayEditor();

    expect(screen.getByTestId("map-container")).toHaveAttribute("data-max-zoom", "22");
    expect(screen.getAllByTestId("saved-map-marker").some((marker) =>
      marker.getAttribute("data-icon-class") === "polygon-split-handle"
    )).toBe(true);
  });

  it("prompts for a visual crossing and commits a Junction split", async () => {
    vi.mocked(services.map.createRouteNode).mockImplementation(async (node) => ({ ...node, id: "42" }));
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "A", nodeType: "Junction", lat: 16.72, lng: 121.689 },
      { id: "node-b", name: "B", nodeType: "Junction", lat: 16.722, lng: 121.691 },
      { id: "node-c", name: "C", nodeType: "Junction", lat: 16.72, lng: 121.691 },
      { id: "node-d", name: "D", nodeType: "Junction", lat: 16.722, lng: 121.689 },
    ]);
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-ab", name: "A–B", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
      { id: "path-cd", name: "C–D", sourceNodeId: "node-c", destinationNodeId: "node-d", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: /Show map issues/ }));
    expect(await screen.findByRole("alert", { name: "Non-routable pathway crossing" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Junction & Split Pathway" }));
    await waitFor(() => expect(services.map.createRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringContaining("Junction"),
      nodeType: "Junction",
      lat: expect.any(Number),
      lng: expect.any(Number),
    })));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Non-routable pathway crossing" })).not.toBeInTheDocument());

    fireEvent.change(await screen.findByLabelText("Route Node name"), { target: { value: "Central Crossing" } });
    fireEvent.change(screen.getByLabelText("Route Node type"), { target: { value: "Access Point" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Route Node" }));
    await waitFor(() => expect(services.map.updateRouteNode).toHaveBeenCalledWith(expect.objectContaining({
      id: "42",
      name: "Central Crossing",
      nodeType: "Access Point",
    })));
  });
});
