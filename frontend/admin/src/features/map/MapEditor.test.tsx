import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import { generatedMapFixture } from "../../services/generatedMapFixture";
import { useMapEditorTestLifecycle, renderEditor, clickMap } from "./testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("./testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("./testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../services/api", async () => (await import("./testing/mapEditorMocks")).apiMock());
vi.mock("../auth/AuthContext", async () => (await import("./testing/mapEditorMocks")).authContextMock());

describe("Map Editor preview", () => {
  useMapEditorTestLifecycle();

  it("switches drawing tools from a minimizable command dock without losing the active mode", async () => {
    renderEditor();

    const polygonTool = await screen.findByRole("button", { name: "Building Polygon" });
    fireEvent.click(polygonTool);

    expect(polygonTool).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("status", { name: "Building Polygon guidance" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Minimize map command dock" }));

    const minimizedDock = screen.getByRole("button", { name: "Expand map command dock" });
    expect(minimizedDock).toHaveTextContent("Building Polygon");

    fireEvent.click(minimizedDock);
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

  });

  it("opens the requested creation tool from a Locations handoff", async () => {
    renderEditor(["/map-editor?create=building"]);
    expect(await screen.findByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
  });

  it("credits OSM fixture overlays while using satellite tiles", async () => {
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Satellite" }));

    expect(screen.getByLabelText("Map attribution")).toHaveTextContent("Esri");
    expect(screen.getByLabelText("Map attribution")).toHaveTextContent("OpenStreetMap contributors");
  });

  it("keeps satellite imagery available through the same zoom range as the street map", async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Satellite" }));

    expect(screen.getByTestId("map-container")).toHaveAttribute("data-max-zoom", "22");
    expect(screen.getByLabelText("Map attribution")).toHaveAttribute("data-max-zoom", "22");
    expect(screen.getByLabelText("Map attribution")).toHaveAttribute("data-max-native-zoom", "18");
  });

  it("loads the generated OSM fixture and keeps boundary safeguards active", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue(generatedMapFixture.buildings);
    vi.mocked(services.map.locations).mockResolvedValue(generatedMapFixture.locations);
    vi.mocked(services.map.nodes).mockResolvedValue(generatedMapFixture.nodes);
    vi.mocked(services.map.pathways).mockResolvedValue(generatedMapFixture.pathways);
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("Search campus places..."), { target: { value: "Main Library" } });
    expect(await screen.findByRole("button", { name: /Main Library Location/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Route Node" }));
    clickMap(16.8, 121.7);

    expect(screen.getByText("New or modified geometry must stay inside the ISU Echague campus boundary.")).toBeInTheDocument();
  });
});
