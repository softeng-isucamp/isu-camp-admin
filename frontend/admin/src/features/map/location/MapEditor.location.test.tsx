import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, mapTestState } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("preserves a Location rename while mapped geometry remains read-only", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Library" } });
    fireEvent.change(screen.getByRole("textbox", { name: /DESCRIPTION/ }), { target: { value: "Campus library services" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Location" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
  });

  it("edits Location details from the object card and records a Working Session operation", async () => {
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Campus library services", keywords: "books, study", floor: "Ground Floor" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));

    const locationCard = screen.getByRole("complementary", { name: "Library object details" });
    expect(locationCard).toHaveTextContent("[Locations]");
    expect(locationCard).toHaveTextContent("Campus library services");
    expect(locationCard).toHaveTextContent("books, study");
    expect(locationCard).toHaveTextContent("16.720500, 121.689500");
    expect(locationCard).toHaveTextContent("Active");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    const typeOptions = within(screen.getAllByRole("combobox")[0]).getAllByRole("option");
    expect(typeOptions.map((option) => option.textContent)).toEqual(["Building", "Facility"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Location" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
  });

  it.skip("moves a point through the precision HUD with nudging, commit, and cancel", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));

    const moveHud = screen.getByRole("region", { name: "Move Library" });
    expect(screen.getByLabelText("Move latitude")).toHaveValue(16.7205);
    expect(screen.getByLabelText("Move longitude")).toHaveValue(121.6895);
    expect(moveHud).toHaveTextContent("Arrow keys 0.5m");

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(Number((screen.getByLabelText("Move latitude") as HTMLInputElement).value)).toBeGreaterThan(16.7205);
    expect(moveHud).toHaveTextContent("Δ 0.5m");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Move Library" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("16.720500");

    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));
    fireEvent.focus(screen.getByLabelText("Move latitude"));
    fireEvent.change(screen.getByLabelText("Move latitude"), { target: { value: "16.72" } });
    expect(screen.getByLabelText("Move latitude")).toHaveValue(16.72);
    fireEvent.change(screen.getByLabelText("Move latitude"), { target: { value: "16.720800" } });
    fireEvent.change(screen.getByLabelText("Move longitude"), { target: { value: "121.690200" } });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("16.720800");
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("121.690200");
  });

  it.skip("renders direct drag feedback, snaps within 18px, and blocks an out-of-bound drop", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [[16.7207, 121.6897]] },
    ]);
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "✥ Move Marker" }));

    const marker = screen.getByTestId("move-point-marker");
    mapTestState.movingPointDragPosition = { lat: 16.7207, lng: 121.68982 };
    fireEvent.dragStart(marker);
    fireEvent.drag(marker);

    expect(screen.getByRole("region", { name: "Move Library" })).toHaveTextContent("(Snapped)");
    expect(screen.getByLabelText("Move longitude")).toHaveValue(121.6897);
    expect(screen.getByTestId("point-move-tether")).toHaveAttribute(
      "data-positions",
      JSON.stringify([[16.7205, 121.6895], [16.7207, 121.6897]]),
    );
    expect(screen.getByTestId("point-move-tether-badge")).toHaveTextContent("Δ 30.8m (Snapped)");

    mapTestState.movingPointDragPosition = { lat: 16.8, lng: 121.7 };
    fireEvent.drag(marker);
    expect(screen.getByRole("alert")).toHaveTextContent("outside the ISU Echague Campus Boundary");
    expect(screen.getByRole("button", { name: "Save Position" })).toBeDisabled();
    expect(screen.getByTestId("move-point-marker")).toHaveAttribute("data-position", "16.8,121.7");

    fireEvent.dragEnd(screen.getByTestId("move-point-marker"));
    expect(screen.getByRole("alert")).toHaveTextContent("Point drop was blocked");
    expect(screen.getByRole("button", { name: "Save Position" })).toBeEnabled();
    expect(screen.getByTestId("move-point-marker")).toHaveAttribute("data-position", "16.7207,121.6897");
  });

  it.skip("unpositions Outdoor Locations and cascades Route Node deletion to connected Pathways", async () => {
    vi.mocked(services.map.pathways).mockResolvedValue([
      { id: "path-1", name: "North Walk", sourceNodeId: "node-a", destinationNodeId: "node-b", distance: "10 m", time: "1 min", shade: "Mostly Shaded", type: "Walkway", direction: "Two-way", status: "Open", pathPoints: [] },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "⎋ Remove Position" }));
    expect(screen.getByRole("complementary", { name: "Library object details" })).toHaveTextContent("Not positioned");

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Entrance" } });
    fireEvent.click(await screen.findByRole("button", { name: /North Entrance Route Node/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for North Entrance" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Deactivate Route Node/ }));

    fireEvent.change(screen.getByPlaceholderText("Search campus places..."), { target: { value: "North Walk" } });
    expect(screen.queryAllByRole("button", { name: "North Walk Pathway" })).toHaveLength(0);
  });
});
