import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { services } from "../../../services/api";
import { useMapEditorTestLifecycle, renderEditor, clickMap, mapFlyTo } from "../testing/mapEditorTestHarness";

vi.mock("leaflet", async () => (await import("../testing/mapEditorMocks")).leafletMock());
vi.mock("react-leaflet", async () => (await import("../testing/mapEditorMocks")).reactLeafletMock());
vi.mock("../../../services/api", async () => (await import("../testing/mapEditorMocks")).apiMock());
vi.mock("../../auth/AuthContext", async () => (await import("../testing/mapEditorMocks")).authContextMock());

const hall = { id: "hall-1", name: "Engineering Hall", code: "ENG", points: [[16.720, 121.689], [16.721, 121.689], [16.721, 121.690]] as [number, number][] };

const openIssues = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Show map issues/ }));
  return screen.getByRole("region", { name: "Map issues" });
};

describe("Map Editor issues tray", () => {
  useMapEditorTestLifecycle();

  it("lists a building without an entrance and focuses it: flies there at zoom 20 and opens its inspector", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    renderEditor();
    const tray = await openIssues();

    expect(within(tray).getByRole("button", { name: /No entrance/ })).toHaveTextContent("1");
    fireEvent.click(within(tray).getByRole("button", { name: /Engineering Hall/ }));

    expect(await screen.findByRole("complementary", { name: "Engineering Hall object details" })).toBeInTheDocument();
    expect(mapFlyTo).toHaveBeenCalledTimes(1);
    expect(mapFlyTo).toHaveBeenLastCalledWith([expect.any(Number), expect.any(Number)], 20, expect.anything());
    expect(services.map.createRouteNode).not.toHaveBeenCalled();
    // The tray stays open with the row marked.
    expect(within(screen.getByRole("region", { name: "Map issues" })).getByRole("button", { name: /Engineering Hall/ })).toHaveAttribute("aria-current", "true");
  });

  it("flies again when the same issue is focused twice", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    renderEditor();
    const row = within(await openIssues()).getByRole("button", { name: /Engineering Hall/ });

    fireEvent.click(row);
    fireEvent.click(row);

    expect(mapFlyTo).toHaveBeenCalledTimes(2);
  });

  it("reports nothing for a building that has an active entrance", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "hall-door", name: "Hall Door", nodeType: "Entrance", associatedPlaceId: "hall-1", lat: 16.7205, lng: 121.6895 },
    ]);
    renderEditor();

    await screen.findByRole("button", { name: "Building Polygon" });
    expect(screen.queryByRole("button", { name: /Show map issues/ })).not.toBeInTheDocument();
  });

  it("only flies, without leaving the tool or selecting, while a tool draft is in progress", async () => {
    vi.mocked(services.map.buildings).mockResolvedValue([hall]);
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Building Polygon" }));
    clickMap(16.7201, 121.6891);
    clickMap(16.7202, 121.6892);

    const tray = await openIssues();
    fireEvent.click(within(tray).getByRole("button", { name: /Engineering Hall/ }));

    expect(mapFlyTo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Building Polygon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Points plotted: 2")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Engineering Hall object details" })).not.toBeInTheDocument();
  });
});
