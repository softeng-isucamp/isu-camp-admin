import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { services } from "../../../services/api";
import type { RouteNode } from "../../../types";
import { MapEditor } from "../MapEditor";
import { mapClickHandler, resetMapMockState } from "./mapEditorMocks";

export { mapClickHandler, mapFitBounds, mapFlyTo, mapTestState, mapZoomEndHandler } from "./mapEditorMocks";

/** Registers the shared beforeEach/afterEach for a Map Editor integration describe block. */
export const useMapEditorTestLifecycle = () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    resetMapMockState();
    services.locations.save = undefined as unknown as typeof services.locations.save;
    vi.mocked(services.locations.saveIndoorPosition).mockReset();
    vi.mocked(services.map.removeBuilding).mockResolvedValue(undefined);
    vi.mocked(services.map.createRouteNode).mockImplementation(async (node) => ({ ...node, id: "created-node" }));
    vi.mocked(services.map.updateRouteNode).mockImplementation(async (node) => node);
    vi.mocked(services.map.deleteRouteNode).mockResolvedValue(undefined);
    vi.mocked(services.map.createPathway).mockImplementation(async (pathway) => ({ ...pathway, id: "created-pathway" }));
    vi.mocked(services.map.convertPathPoint).mockReset();
    vi.mocked(services.map.convertPathPoint).mockImplementation(async (request) => ({
      node: { ...(request.node ?? { id: request.existingNodeId, name: "Existing Junction", nodeType: "Junction", lat: request.point[0], lng: request.point[1] }), id: request.existingNodeId ?? "created-conversion-node" } as RouteNode,
      pathways: request.pathways.map((pathway, index) => ({ ...pathway, id: `created-segment-${index}` })) as [typeof request.pathways[0], typeof request.pathways[1]],
    }));
    vi.mocked(services.map.updatePathway).mockImplementation(async (pathway) => pathway);
    vi.mocked(services.map.deletePathway).mockResolvedValue(undefined);
    vi.mocked(services.map.buildings).mockResolvedValue([]);
    vi.mocked(services.map.locations).mockResolvedValue([
      { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
    ]);
    vi.mocked(services.map.nodes).mockResolvedValue([
      { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
      { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.69 },
    ]);
    vi.mocked(services.map.buildings).mockResolvedValue([]);
  });
  afterEach(cleanup);
};

export const renderEditor = (initialEntries = ["/map-editor"]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}><MapEditor /></MemoryRouter></QueryClientProvider>);
};

export const clickMap = (lat: number, lng: number) => {
  act(() => mapClickHandler?.({ latlng: { lat, lng } }));
};

export const choosePathwayEditor = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Create or edit Pathway" }));
};

export const chooseWalkingNetworkBrowser = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Pathway" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Browse Walking Network" }));
};
