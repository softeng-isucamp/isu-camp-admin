import { useState } from "react";
import { vi } from "vitest";
import type { services } from "../../../services/api";

export let mapClickHandler: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;
export let mapZoomEndHandler: (() => void) | undefined;
export let mapFitBounds = vi.fn();
export let mapFlyTo = vi.fn();
export const mapTestState: {
  zoom: number;
  pathPointDragPosition: { lat: number; lng: number } | undefined;
  movingPointDragPosition: { lat: number; lng: number } | undefined;
  visibleBounds: {
    getSouth: () => number;
    getNorth: () => number;
    getWest: () => number;
    getEast: () => number;
  } | undefined;
} = {
  zoom: 18,
  pathPointDragPosition: undefined,
  movingPointDragPosition: undefined,
  visibleBounds: undefined,
};

export const resetMapMockState = () => {
  mapClickHandler = undefined;
  mapZoomEndHandler = undefined;
  mapTestState.zoom = 18;
  mapTestState.pathPointDragPosition = undefined;
  mapTestState.movingPointDragPosition = undefined;
  mapFitBounds = vi.fn();
  mapFlyTo = vi.fn();
  mapTestState.visibleBounds = undefined;
};

export const leafletMock = () => {
  let iconId = 0;
  return { default: {
    divIcon: (options: { className?: string; iconSize?: [number, number] }) => ({ ...options, testId: ++iconId }),
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    point: (x: number, y: number) => ({ x, y }),
  } };
};

export const reactLeafletMock = () => ({
  MapContainer: ({ children, maxZoom }: { children: React.ReactNode; maxZoom?: number }) => <div data-testid="map-container" data-max-zoom={maxZoom}>{children}</div>,
  Marker: ({ position, eventHandlers, draggable, icon }: { position: [number, number]; eventHandlers?: { click?: () => void; dragstart?: () => void; drag?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void; dragend?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void }; draggable?: boolean; icon?: { className?: string; iconSize?: [number, number]; testId?: number } }) => typeof draggable === "boolean" && icon?.className === "path-point-icon selected"
    ? <button aria-label={`Path Point at ${position.join(",")}`} data-testid="path-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} data-icon-id={icon.testId} data-icon-size={icon.iconSize?.join(",")} onClick={eventHandlers?.click} onDrag={() => mapTestState.pathPointDragPosition && eventHandlers?.drag?.({ target: { getLatLng: () => mapTestState.pathPointDragPosition! } })} onDragEnd={() => mapTestState.pathPointDragPosition && eventHandlers?.dragend?.({ target: { getLatLng: () => mapTestState.pathPointDragPosition! } })} />
    : eventHandlers?.drag ? <button aria-label={`Move point at ${position.join(",")}`} data-testid="move-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} onClick={eventHandlers.click} onDragStart={eventHandlers.dragstart} onDrag={() => mapTestState.movingPointDragPosition && eventHandlers.drag?.({ target: { getLatLng: () => mapTestState.movingPointDragPosition! } })} onDragEnd={() => mapTestState.movingPointDragPosition && eventHandlers.dragend?.({ target: { getLatLng: () => mapTestState.movingPointDragPosition! } })} />
    : typeof draggable === "boolean" ? <button aria-label={`Path Point at ${position.join(",")}`} data-testid="path-point-marker" data-position={position.join(",")} data-draggable={String(draggable)} onClick={eventHandlers?.click} onDragEnd={() => mapTestState.pathPointDragPosition && eventHandlers?.dragend?.({ target: { getLatLng: () => mapTestState.pathPointDragPosition! } })} /> : icon ? <button aria-label={`Map marker at ${position.join(",")}`} data-testid="saved-map-marker" data-icon-class={icon.className} data-position={position.join(",")} onClick={eventHandlers?.click} /> : null,
  Polygon: ({ eventHandlers, pathOptions }: { eventHandlers?: { click?: () => void }; pathOptions?: { className?: string } }) => <button aria-label={pathOptions?.className ?? "building polygon"} onClick={eventHandlers?.click} />,
  Polyline: ({ positions, pathOptions, children, eventHandlers }: { positions: [number, number][]; pathOptions?: { className?: string; color?: string }; children?: React.ReactNode; eventHandlers?: { click?: () => void } }) => <output data-testid={pathOptions?.className === "point-move-tether" ? "point-move-tether" : "path-geometry"} data-positions={JSON.stringify(positions)} data-color={pathOptions?.color} onClick={eventHandlers?.click}>{children}</output>,
  Popup: () => null,
  TileLayer: ({ attribution, maxNativeZoom, maxZoom, url }: { attribution: string; maxNativeZoom?: number; maxZoom?: number; url: string }) => {
    const [effectiveMaxNativeZoom] = useState(maxNativeZoom);
    return <div aria-label="Map attribution" data-max-native-zoom={effectiveMaxNativeZoom} data-max-zoom={maxZoom} data-tile-url={url}>{attribution}</div>;
  }, Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMap: () => ({
    flyTo: (...args: unknown[]) => mapFlyTo(...args),
    fitBounds: (...args: unknown[]) => mapFitBounds(...args),
    getBounds: mapTestState.visibleBounds ? () => mapTestState.visibleBounds : undefined,
    getZoom: () => mapTestState.zoom,
    latLngToContainerPoint: ({ lat, lng }: { lat: number; lng: number }) => ({ x: lng * 100_000, y: lat * 100_000 }),
    containerPointToLatLng: ({ x, y }: { x: number; y: number }) => ({ lat: y / 100_000, lng: x / 100_000 }),
  }),
  useMapEvents: ({ click, zoomend }: { click: (event: { latlng: { lat: number; lng: number } }) => void; zoomend?: () => void }) => {
    mapClickHandler = click;
    mapZoomEndHandler = zoomend;
  },
});

export const apiMock = () => ({
  setMockFailure: vi.fn(),
  services: {
    map: {
      buildings: vi.fn(async () => []),
      locations: vi.fn(async () => [
        { id: "loc-1", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: 16.7205, lng: 121.6895, positioned: true },
      ]),
      nodes: vi.fn(async () => [
        { id: "node-a", name: "North Entrance", nodeType: "Entrance", associatedPlaceId: null, lat: 16.7205, lng: 121.6895 },
        { id: "node-b", name: "South Junction", nodeType: "Junction", associatedPlaceId: null, lat: 16.721, lng: 121.69 },
      ]),
      pathways: vi.fn(async () => []),
      removeBuilding: vi.fn(async () => undefined),
      createRouteNode: vi.fn(async (node) => ({ ...node, id: "created-node" })),
      updateRouteNode: vi.fn(async (node) => node),
      deleteRouteNode: vi.fn(async () => undefined),
      createPathway: vi.fn(async (pathway) => ({ ...pathway, id: "created-pathway" })),
      convertPathPoint: vi.fn(),
      updatePathway: vi.fn(async (pathway) => pathway),
      deletePathway: vi.fn(async () => undefined),
      save: vi.fn(),
    },
    locations: {
      list: vi.fn(async () => ({
        items: [
          { id: "loc-1", name: "Library", code: "LIB", type: "Facility" as const, parentId: null, status: "Active" as const, lat: 16.7205, lng: 121.6895, positioned: true },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      })),
      save: undefined as unknown as typeof services.locations.save,
      saveIndoorPosition: vi.fn(),
      getPhotos: vi.fn(async () => []),
    },
  },
});

export const authContextMock = () => ({
  useAuth: () => ({
    session: { id: "test-admin", username: "test-admin" },
    login: vi.fn(),
    logout: vi.fn(),
    loading: false,
  }),
});
