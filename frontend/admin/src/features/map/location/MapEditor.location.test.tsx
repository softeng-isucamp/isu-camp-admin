import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor } from "../testing/mapEditorTestHarness";

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
      { id: "loc-1", name: "Library", code: "LIB", type: "Place", classification: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Campus library services", keywords: "books, study", floor: "Ground Floor" },
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
    expect(typeOptions.map((option) => option.textContent)).toEqual(["College", "Campus Services", "Food", "Parking", "Facility"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Location" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(screen.getByRole("complementary", { name: "Main Library object details" })).toBeInTheDocument();
  });

  it("refuses a leaf classification for a Place whose indoor Locations came from the map data, without saving", async () => {
    const save = vi.fn();
    services.locations.save = save;
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Place", classification: "College", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true, function: "Library" },
      { id: "room-1", name: "Reading Room", code: "RR", type: "Room", parentId: "loc-1", building: "Library", floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false, function: "Reading" },
    ]);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Library" } });
    fireEvent.click(await screen.findByRole("button", { name: /Library Location/ }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "✎ Edit Details" }));
    const select = screen.getByLabelText(/^location type/i);
    expect([...(select as HTMLSelectElement).options].filter((option) => option.disabled).map((option) => option.text)).toEqual(["Food", "Parking", "Facility"]);

    fireEvent.change(select, { target: { value: "Parking" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(await screen.findAllByText("Move or delete its 1 indoor Location before classifying it as Food, Parking, or Facility.")).not.toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });
});
