import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { allPermissions, viewOnlyPermissions } from "../../lib/permissions";
import { choosePathwayEditor, clickMap, mapTestSession, renderEditor, useMapEditorTestLifecycle } from "./testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("./testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("./testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../services/api", async () => (await import("./testing/mapEditorMocks")).apiMock());
vi.mock("../auth/AuthContext", async () => (await import("./testing/mapEditorMocks")).authContextMock());

const hall = { id: "building-eng", name: "Engineering Hall", code: "ENG", classification: "College" as const, points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] as [number, number][] };

const signInWith = (permissions: typeof mapTestSession.permissions) => {
  mapTestSession.role = "admin";
  mapTestSession.permissions = permissions;
};

describe("Map Editor for a restricted administrator", () => {
  useMapEditorTestLifecycle();

  it("lets a view-only administrator select and read a Building, with no actions and no ⋯ trigger", async () => {
    signInWith(viewOnlyPermissions());
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));

    const card = await screen.findByRole("complementary", { name: "Engineering Hall object details" });
    expect(within(card).getByText("ENG")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Reshape Footprint/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Add indoor location|Add entrance|Link existing entrance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions for Engineering Hall" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Clear object selection" })).toBeInTheDocument();
  });

  it("trims the tool rail to Select and the walking network browser, and Browse still opens", async () => {
    signInWith(viewOnlyPermissions());
    renderEditor();

    expect(await screen.findByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Route Node" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Building Polygon" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Walking Network" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse Walking Network" }));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Browse Walking Network" })).not.toBeInTheDocument());
  });

  it("offers a Route Node only the actions its switches allow", async () => {
    signInWith({ ...viewOnlyPermissions(), delete: true });
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    const card = await screen.findByRole("complementary", { name: "North Entrance object details" });
    expect(within(card).queryByRole("button", { name: /Move Entrance/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Update Route Node" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "More actions for North Entrance" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["🗑 Delete Route Node"]);
  });

  it("keeps every action for an administrator with every switch on", async () => {
    signInWith(allPermissions());
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "building polygon" }));

    expect(await screen.findByRole("button", { name: "▱ Reshape Footprint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for Engineering Hall" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Building Polygon" })).toBeInTheDocument();
  });
});

const legacyPath = { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", shade: "Mostly Shaded" as const, type: "Walkway" as const, direction: "Two-way" as const, status: "Open" as const, pathPoints: [[16.7207, 121.6897]] as [number, number][] };

describe("Map workflow permission regressions", () => {
  useMapEditorTestLifecycle();

  it("keeps Add-only pathway creation separate from existing legacy pathways", async () => {
    signInWith({ ...viewOnlyPermissions(), add: true });
    vi.mocked(services.map.pathways).mockResolvedValue([legacyPath]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    expect(screen.queryByRole("button", { name: "Update Pathway" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Pathway name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("path-point-marker")).not.toBeInTheDocument();
  });

  it("does not let Add-only provisional pathways switch to saved pathways", async () => {
    signInWith({ ...viewOnlyPermissions(), add: true });
    vi.mocked(services.map.pathways).mockResolvedValue([{ ...legacyPath, sourceNodeId: "other-node", status: "Active" }]);
    renderEditor();
    await choosePathwayEditor();
    fireEvent.click((await screen.findAllByRole("button", { name: "Map marker at 16.7205,121.6895" })).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Map marker at 16.721,121.69" }));
    expect(screen.getByRole("button", { name: "Save Pathway" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "North Walk" })).not.toBeInTheDocument();
  });

  it("allows Edit-only administrators to enter existing-pathway editing", async () => {
    signInWith({ ...viewOnlyPermissions(), edit: true });
    vi.mocked(services.map.pathways).mockResolvedValue([legacyPath]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    expect(screen.getAllByRole("button", { name: "Update Pathway" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /New Pathway/ })).not.toBeInTheDocument();
  });

  it("discards recovered creation drafts after Add is removed", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    cleanup();
    signInWith({ ...viewOnlyPermissions(), edit: true });
    renderEditor();
    await screen.findByRole("button", { name: "Select" });
    expect(screen.queryByText("Points plotted: 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  });

  it("discards a suspended edit draft when Edit is removed even if Add remains", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([legacyPath]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    clickMap(16.7208, 121.6898);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Draft for Later (Suspend)" }));
    signInWith({ ...viewOnlyPermissions(), add: true });
    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspended Drafts (1)" }));
    expect(screen.queryByRole("button", { name: "Resume Pathway draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update Pathway" })).not.toBeInTheDocument();
  });

  it("exits an active pathway edit when Edit is removed", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([legacyPath]);
    renderEditor();
    await screen.findByTestId("path-geometry");
    await choosePathwayEditor();
    signInWith({ ...viewOnlyPermissions(), add: true });
    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North" } });
    expect(screen.queryByRole("button", { name: "Update Pathway" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("path-point-marker")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Recovered moves and Add composite operations", () => {
  useMapEditorTestLifecycle();

  it("rejects a recovered Route Node move without Edit and cannot nudge or save it", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: /Move Entrance/ }));
    clickMap(16.7208, 121.6898);
    expect(screen.getByRole("button", { name: "Save Position" })).toBeInTheDocument();
    cleanup();
    signInWith({ ...viewOnlyPermissions(), add: true });
    renderEditor();
    await screen.findByPlaceholderText("Search campus places...");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByRole("button", { name: "Save Position" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("move-point-marker")).not.toBeInTheDocument();
    expect(services.map.updateRouteNode).not.toHaveBeenCalled();
  });

  it("allows Add-only conversion of a saved Path Point without offering coordinate editing", async () => {
    signInWith({ ...viewOnlyPermissions(), add: true });
    vi.mocked(services.map.pathways).mockResolvedValue([legacyPath]);
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    fireEvent.click(await screen.findByRole("button", { name: "North Walk Pathway" }));
    const point = await screen.findByRole("button", { name: "Path Point at 16.7207,121.6897" });
    expect(point).toHaveAttribute("data-draggable", "false");
    fireEvent.click(point);
    expect(screen.queryByLabelText("Path Point latitude")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Path Point #1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert to Route Node" }));
    const dialog = await screen.findByRole("dialog", { name: "Convert Path Point to Route Node" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Route Node and Pathways" }));
    await waitFor(() => expect(services.map.convertPathPoint).toHaveBeenCalledWith(expect.objectContaining({ pathwayId: "path-1" })));
    expect(services.map.updatePathway).not.toHaveBeenCalled();
  });
});
