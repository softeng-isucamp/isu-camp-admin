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
});
