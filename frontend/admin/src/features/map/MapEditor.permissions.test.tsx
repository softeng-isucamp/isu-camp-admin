import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { allPermissions, viewOnlyPermissions } from "../../lib/permissions";
import { mapTestSession, renderEditor, useMapEditorTestLifecycle } from "./testing/mapEditorTestHarness";

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
