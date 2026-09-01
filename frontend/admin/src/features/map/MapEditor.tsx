import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import { campusCenter } from "../../services/mockData";
import { Button, Modal } from "../../components/UI";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { polygonCentroid, polygonFeatureAnchor, polygonSelfIntersects, reviewMapDraft, translatePolygon, withoutEndpointPathPoints, type MapObjectReference } from "./mapEditing";
import { ToolInterruptionDialog, ToolRailDock } from "./ToolRailDock";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { InspectorCardHUD, type InspectorCardModel } from "./InspectorCardHUD";
import { LocalFeatureDetailsModal } from "./LocalFeatureDetailsModal";
import { LocalFeatureFamilyPalette } from "./LocalFeatureFamilyPalette";
import {
  buildRestoreLocalFeatureOperation,
  buildRetireLocalFeatureOperation,
  EDITABLE_LOCAL_FEATURE_FAMILIES,
  getLocalFeaturePathOptions,
} from "./localFeatures";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import { RouteDetailsModal } from "../routes/RouteDetailsModal";
import {
  mapEditorApiClient,
  normalizeMapLayers,
  type ConflictingEntityDiff,
  type FeatureLinkEntity,
  type LocalFeatureFamily,
  type LocalMapFeatureEntity,
  type MapEditorLayers,
} from "../../services/mapEditorApiClient";
import type { ActiveToolDraft, SpatialDomain, ToolType, WorkingOperation } from "./types";
import {
  echagueCampusBoundary,
  geometryOnCampus,
  paddedCampusBounds,
  pointOnCampus,
  type MapPoint,
} from "./campusBoundary";
import {
  distanceInMeters,
  findPointSnap,
  nudgePoint,
  type PointSnapTarget,
} from "./pointInteractions";
import {
  findPathwayCrossings,
  insertPathPointAtSegmentMidpoint,
  pathwayConnectionError,
  segmentMidpoints,
} from "./pathwayTopology";
import { createRoutableCrossing } from "./pathwayCommands";
import "leaflet/dist/leaflet.css";

const createLocationPinIcon = (selected = false) =>
  L.divIcon({
    className: `location-marker-icon ${selected ? "selected" : ""}`,
    html: `<div class="location-icon ${selected ? "selected" : ""}"><span class="location-pin"></span></div>`,
    iconSize: [26, 32],
    iconAnchor: [13, 30],
  });

const createNodeIcon = (selected = false) =>
  L.divIcon({
    className: `route-node-icon ${selected ? "selected" : ""}`,
    html: `<div class="route-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const createPointIcon = (selected = false) =>
  L.divIcon({
    className: `path-point-icon ${selected ? "selected" : ""}`,
    html: `<div class="point-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

const createPathPointSplitHandleIcon = () =>
  L.divIcon({
    className: "path-point-split-handle-icon",
    html: '<button type="button" aria-label="Add Path Point" class="path-point-split-handle">+</button>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const createTempIcon = () =>
  L.divIcon({
    className: "temp-marker-icon",
    html: `<div class="temp-icon"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const createGhostPointIcon = () =>
  L.divIcon({
    className: "point-move-ghost-icon",
    html: `<div class="point-move-ghost"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const createMovingPointIcon = (outsideBoundary: boolean, elevated: boolean) =>
  L.divIcon({
    className: `point-moving-icon${outsideBoundary ? " outside-boundary" : ""}${elevated ? " elevated" : ""}`,
    html: `<div class="point-moving-marker${outsideBoundary ? " outside-boundary" : ""}${elevated ? " elevated" : ""}"><span></span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 36],
  });

const splitIcon = L.divIcon({ className: "polygon-split-handle", html: "<span>+</span>", iconSize: [24, 24], iconAnchor: [12, 12] });
const createSplitIcon = () => splitIcon;

const vertexIcons = new Map<number, L.DivIcon>();
const createVertexIcon = (index: number) => {
  const existing = vertexIcons.get(index);
  if (existing) return existing;
  const icon = L.divIcon({ className: "polygon-vertex-handle", html: `<span>V${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  vertexIcons.set(index, icon);
  return icon;
};

interface PointMoveLayerProps {
  origin: MapPoint;
  position: MapPoint;
  snapTargets: PointSnapTarget[];
  campusBoundary: MapPoint[];
  outsideBoundary: boolean;
  distanceMeters: number;
  snapped: boolean;
  onPositionChange: (point: MapPoint, snapped: boolean) => void;
  onDropRejected: () => void;
  onDraggingChange: (dragging: boolean) => void;
}

function PointMoveLayer({
  origin,
  position,
  snapTargets,
  campusBoundary,
  outsideBoundary,
  distanceMeters,
  snapped,
  onPositionChange,
  onDropRejected,
  onDraggingChange,
}: PointMoveLayerProps) {
  const map = useMap();
  const resolvePosition = (event: L.LeafletEvent) => {
    const candidateLatLng = (event.target as L.Marker).getLatLng();
    const candidate: MapPoint = [candidateLatLng.lat, candidateLatLng.lng];
    const snap = findPointSnap(
      candidate,
      snapTargets,
      ([lat, lng]) => {
        const projected = map.latLngToContainerPoint(L.latLng(lat, lng));
        return { x: projected.x, y: projected.y };
      },
      ({ x, y }) => {
        const latLng = map.containerPointToLatLng(L.point(x, y));
        return [latLng.lat, latLng.lng];
      },
    );
    return { point: snap?.point ?? candidate, snapped: Boolean(snap) };
  };

  return (
    <>
      <Marker position={origin} icon={createGhostPointIcon()} />
      <Polyline
        positions={[origin, position]}
        pathOptions={{
          className: "point-move-tether",
          color: outsideBoundary ? "#b42318" : "#005931",
          dashArray: "6 6",
          weight: 2,
        }}
      >
        <Tooltip permanent direction="center" className="point-move-tether-badge">
          <span data-testid="point-move-tether-badge">
            Δ {distanceMeters.toFixed(1)}m {snapped && "(Snapped)"}
          </span>
        </Tooltip>
      </Polyline>
      <Marker
        position={position}
        icon={createMovingPointIcon(outsideBoundary, true)}
        draggable
        eventHandlers={{
          dragstart: () => onDraggingChange(true),
          drag: (event) => {
            const resolved = resolvePosition(event);
            onPositionChange(resolved.point, resolved.snapped);
          },
          dragend: (event) => {
            const resolved = resolvePosition(event);
            if (pointOnCampus(resolved.point, campusBoundary)) {
              onPositionChange(resolved.point, resolved.snapped);
            } else {
              onDropRejected();
            }
            onDraggingChange(false);
          },
        }}
      />
    </>
  );
}

interface PointCoordinateInputsProps {
  position: MapPoint;
  onChange: (point: MapPoint) => void;
}

function PointCoordinateInputs({ position, onChange }: PointCoordinateInputsProps) {
  const [latitudeText, setLatitudeText] = useState(position[0].toFixed(6));
  const [longitudeText, setLongitudeText] = useState(position[1].toFixed(6));
  const [editing, setEditing] = useState<"latitude" | "longitude" | null>(null);

  useEffect(() => {
    if (editing !== "latitude") setLatitudeText(position[0].toFixed(6));
    if (editing !== "longitude") setLongitudeText(position[1].toFixed(6));
  }, [editing, position]);

  const updateLatitude = (value: string) => {
    setLatitudeText(value);
    const latitude = Number(value);
    if (value.trim() && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) {
      onChange([latitude, position[1]]);
    }
  };
  const updateLongitude = (value: string) => {
    setLongitudeText(value);
    const longitude = Number(value);
    if (value.trim() && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
      onChange([position[0], longitude]);
    }
  };

  return (
    <div className="point-move-coordinate-grid">
      <label>Lat
        <input
          aria-label="Move latitude"
          type="number"
          step="0.000001"
          value={latitudeText}
          onFocus={() => setEditing("latitude")}
          onBlur={() => {
            setEditing(null);
            setLatitudeText(position[0].toFixed(6));
          }}
          onChange={(event) => updateLatitude(event.target.value)}
        />
      </label>
      <label>Lng
        <input
          aria-label="Move longitude"
          type="number"
          step="0.000001"
          value={longitudeText}
          onFocus={() => setEditing("longitude")}
          onBlur={() => {
            setEditing(null);
            setLongitudeText(position[1].toFixed(6));
          }}
          onChange={(event) => updateLongitude(event.target.value)}
        />
      </label>
    </div>
  );
}

interface MapControllerProps {
  onMapClick: (latlng: [number, number]) => void;
  flyTarget: [number, number] | null;
  navigationBounds: [[number, number], [number, number]];
  onViewportChange?: (bounds: L.LatLngBounds | null, zoom: number) => void;
}

const isPointInBounds = (
  lat: number,
  lng: number,
  bounds: L.LatLngBounds | null,
  margin = 0.002
) => {
  if (!bounds || typeof bounds.getSouth !== "function") return true;
  const south = bounds.getSouth() - margin;
  const north = bounds.getNorth() + margin;
  const west = bounds.getWest() - margin;
  const east = bounds.getEast() + margin;
  return lat >= south && lat <= north && lng >= west && lng <= east;
};

const overlayChanges = <T extends { id: string }>(original: T[], changed: T[]) => {
  const changes = new Map(changed.map((item) => [item.id, item]));
  return original.map((item) => changes.get(item.id) ?? item).concat(changed.filter((item) => !original.some((candidate) => candidate.id === item.id)));
};

const routeNodePoint = (nodes: RouteNode[], id: string): [number, number] => {
  const node = nodes.find((candidate) => candidate.id === id);
  return node ? [node.lat, node.lng] : [NaN, NaN];
};

function MapController({
  onMapClick,
  flyTarget,
  navigationBounds,
  onViewportChange,
}: MapControllerProps) {
  const map = useMap();
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const initialFitDoneRef = useRef(false);

  useMapEvents({
    click: (e) => {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
    moveend: () => {
      if (typeof map.getBounds === "function" && typeof map.getZoom === "function") {
        onViewportChangeRef.current?.(map.getBounds(), map.getZoom());
      }
    },
    zoomend: () => {
      if (typeof map.getBounds === "function" && typeof map.getZoom === "function") {
        onViewportChangeRef.current?.(map.getBounds(), map.getZoom());
      }
    },
  });

  useEffect(() => {
    if (typeof map.getBounds === "function" && typeof map.getZoom === "function") {
      onViewportChangeRef.current?.(map.getBounds(), map.getZoom());
    }
  }, [map]);

  useEffect(() => {
    if (flyTarget) {
      map.flyTo(flyTarget, 19, { duration: 0.8 });
    }
  }, [flyTarget, map]);

  useEffect(() => {
    if (typeof map.getBoundsZoom !== "function" || typeof map.setMinZoom !== "function") return;
    const minimumZoom = map.getBoundsZoom(navigationBounds, false);
    map.setMinZoom(minimumZoom);
    if (!initialFitDoneRef.current && map.getZoom() < minimumZoom && typeof map.fitBounds === "function") {
      initialFitDoneRef.current = true;
      map.fitBounds(navigationBounds, { animate: false });
    }
  }, [map, navigationBounds]);

  return null;
}

const isPositionedLocation = (location: Location): location is Location & { lat: number; lng: number } =>
  location.positioned && location.lat !== null && location.lng !== null;

type NewLocationDraft = Pick<Location, "name" | "code" | "type" | "status" | "parentId"> & {
  building: string;
  floor: string;
};

const isNewLocationDraft = (value: unknown): value is NewLocationDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NewLocationDraft>;
  return typeof draft.name === "string"
    && typeof draft.code === "string"
    && typeof draft.type === "string"
    && typeof draft.status === "string"
    && (typeof draft.parentId === "string" || draft.parentId === null)
    && typeof draft.building === "string"
    && typeof draft.floor === "string";
};

const isPathwayDraft = (value: unknown): value is Pathway => {
  if (!value || typeof value !== "object") return false;
  const pathway = value as Partial<Pathway>;
  return typeof pathway.id === "string"
    && typeof pathway.name === "string"
    && typeof pathway.sourceNodeId === "string"
    && typeof pathway.destinationNodeId === "string"
    && typeof pathway.distance === "string"
    && typeof pathway.time === "string"
    && typeof pathway.shade === "string"
    && typeof pathway.type === "string"
    && typeof pathway.direction === "string"
    && typeof pathway.status === "string"
    && Array.isArray(pathway.pathPoints);
};

const MAP_EDITOR_PROJECT_ID = "isu-echague";

export function MapEditor() {
  const queryClient = useQueryClient();
  const routeLocation = useLocation();
  const [workingSessionManager] = useState(() => new WorkingSessionManager());
  const [, setWorkingSessionRevision] = useState(0);
  const [pendingToolRequest, setPendingToolRequest] = useState<{
    toolType: ToolType;
    resumeDraftId?: string;
  } | null>(null);

  useEffect(
    () => workingSessionManager.subscribe(() => {
      setWorkingSessionRevision((revision) => revision + 1);
    }),
    [workingSessionManager],
  );

  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "mapSave") {
      setMockFailure("mapSave", true);
      return () => setMockFailure("mapSave", false);
    }
    return undefined;
  }, []);

  const { data } = useQuery({
    queryKey: ["map"],
    queryFn: async () => ({
      buildings: await services.map.buildings(),
      locations: await services.map.locations(),
      nodes: await services.map.nodes(),
      pathways: await services.map.pathways(),
    }),
  });
  const { data: draftBootstrap } = useQuery({
    queryKey: ["map-editor-bootstrap", MAP_EDITOR_PROJECT_ID],
    queryFn: () => mapEditorApiClient.getMapEditorBootstrap(MAP_EDITOR_PROJECT_ID),
  });
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [authoritativeLayers, setAuthoritativeLayers] = useState<MapEditorLayers | null>(null);
  const [conflictReview, setConflictReview] = useState<{
    entities: ConflictingEntityDiff[];
    serverDraftVersion: number;
  } | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  useEffect(() => {
    if (!draftBootstrap) return;
    setDraftVersion((current) => current ?? draftBootstrap.adminDraft.draftVersion);
    setPublishedVersionId((current) => current ?? draftBootstrap.publishedVersionId);
    setAuthoritativeLayers((current) => current ?? draftBootstrap.layers);
  }, [draftBootstrap]);

  const [localLocations, setLocalLocations] = useState<Location[]>([]);
  const [localNodes, setLocalNodes] = useState<RouteNode[]>([]);
  const [localPathways, setLocalPathways] = useState<Pathway[]>([]);
  const [localBuildings, setLocalBuildings] = useState<Building[]>([]);
  const [localFeatureChanges, setLocalFeatureChanges] = useState<LocalMapFeatureEntity[]>([]);
  const [localFeatureLinks, setLocalFeatureLinks] = useState<FeatureLinkEntity[]>([]);
  const [unlinkedFeatureLinkIds, setUnlinkedFeatureLinkIds] = useState<string[]>([]);
  const [selectedLocalFeatureFamily, setSelectedLocalFeatureFamily] = useState<Exclude<LocalFeatureFamily, "readonly_basemap">>("parking_area");
  const [localFeaturePoints, setLocalFeaturePoints] = useState<[number, number][]>([]);
  const [localFeatureName, setLocalFeatureName] = useState("New Parking Area");
  const [ownerModal, setOwnerModal] = useState<"location" | "route" | "local_feature" | null>(null);
  const [localFeatureActionNotice, setLocalFeatureActionNotice] = useState("");

  const [mode, setMode] = useState<"select" | "place" | "path" | "area" | "move" | "local_feature">(
    "select",
  );
  const [selected, setSelected] = useState<{
    type: "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature";
    id: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [temporary, setTemporary] = useState<[number, number] | null>(null);
  const [pointDraftDirty, setPointDraftDirty] = useState(false);
  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [manualPathPointDrag, setManualPathPointDrag] = useState(false);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [polygonInteraction, setPolygonInteraction] = useState<"draw" | "reshape" | "move">("draw");
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [buildingRecordMode, setBuildingRecordMode] = useState<"create" | "attach">("create");
  const [buildingRecordSearch, setBuildingRecordSearch] = useState("");
  const [selectedBuildingRecordId, setSelectedBuildingRecordId] = useState<string | null>(null);
  const [nonRoutableBuildingId, setNonRoutableBuildingId] = useState<string | null>(null);
  const [buildingName, setBuildingName] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [movingType, setMovingType] = useState<"location" | "node">("location");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<MapPoint | null>(null);
  const [lastValidMovePosition, setLastValidMovePosition] = useState<MapPoint | null>(null);
  const [isPointDragging, setIsPointDragging] = useState(false);
  const [pointIsSnapped, setPointIsSnapped] = useState(false);
  const [moveDropRejected, setMoveDropRejected] = useState(false);
  const [placingObjectType, setPlacingObjectType] = useState<"location" | "node">(
    "location",
  );
  const [placingId, setPlacingId] = useState<string>("");
  const [placingNodeType, setPlacingNodeType] = useState<
    "Entrance" | "Junction" | "Access Point"
  >("Entrance");
  const [placingNodeName, setPlacingNodeName] = useState("");
  const [placingAssociatedPlaceId, setPlacingAssociatedPlaceId] = useState<
    string | null
  >(null);
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: "", code: "", type: "Facility" as Location["type"], status: "Active" as Location["status"], parentId: null as string | null, building: "", floor: "" });

  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [provisionalPathwayId, setProvisionalPathwayId] = useState<string | null>(null);
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [pathDraftDirty, setPathDraftDirty] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const distinctBuildingPointCount = new Set(points.map((point) => point.join(","))).size;
  const polygonInvalid = polygonSelfIntersects(points);
  const canSaveBuilding = points.length >= 3 && distinctBuildingPointCount >= 3 && !polygonInvalid && Boolean(buildingName.trim()) && Boolean(buildingCode.trim());
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "discard" | "publish" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [basemap, setBasemap] = useState<"street" | "satellite">("street");
  const [currentMapBounds, setCurrentMapBounds] = useState<L.LatLngBounds | null>(null);

  const completeToolDraft = (toolType: Exclude<ToolType, "select">) => {
    if (toolType === "point") setPointDraftDirty(false);
    if (toolType === "pathway") {
      setPathDraftDirty(false);
      setProvisionalPathwayId(null);
    }
    workingSessionManager.discardActiveDraft();
  };
  const handleViewportChange = useCallback((bounds: L.LatLngBounds | null) => {
    setCurrentMapBounds(bounds);
  }, []);

  const directoryLocations: Location[] = authoritativeLayers
    ? authoritativeLayers.outdoorLocations.map((location) => {
        const canonicalLocation = data?.locations.find((candidate) => candidate.id === location.id);
        return {
          ...canonicalLocation,
          ...location,
          parentId: canonicalLocation?.parentId ?? null,
          function: canonicalLocation?.function ?? location.category ?? "Campus location",
        };
      })
    : data?.locations || [];
  const directoryNodes: RouteNode[] = authoritativeLayers
    ? authoritativeLayers.routeNodes.map((node) => ({ ...node }))
    : data?.nodes || [];
  const directoryPathways: Pathway[] = authoritativeLayers
    ? authoritativeLayers.pathways.map((pathway) => ({
        ...pathway,
        distance: pathway.distance ?? "",
        time: pathway.time ?? "",
        shade: pathway.shade ?? "Unknown",
        direction: pathway.direction ?? "Unknown",
      }))
    : data?.pathways || [];
  const directoryBuildings: Building[] = authoritativeLayers
    ? authoritativeLayers.buildings.map((building) => {
        const footprint = authoritativeLayers.localFeatures.find((feature) =>
          feature.id === building.linkedFeatureId
          || (feature.family === "building_footprint" && feature.linkedBuildingId === building.id),
        );
        const points = footprint?.geometryType === "polygon" && Array.isArray(footprint.coordinates[0])
          ? footprint.coordinates as [number, number][]
          : [];
        return { ...building, points };
      }).filter((building) => building.points.length >= 3)
    : (data?.buildings || []).filter((building) => building.points.length >= 3);
  const directoryMapLayers = useMemo(() => authoritativeLayers ?? normalizeMapLayers({
    buildings: data?.buildings || [],
    locations: data?.locations || [],
    routeNodes: data?.nodes || [],
    pathways: data?.pathways || [],
  }), [authoritativeLayers, data?.buildings, data?.locations, data?.nodes, data?.pathways]);
  const currentFeatureLinks = [...directoryMapLayers.featureLinks, ...localFeatureLinks]
    .filter((link) => !unlinkedFeatureLinkIds.includes(link.id));
  const buildingAttachmentEligibility = (building: Building) => {
    const activeLink = currentFeatureLinks
      .find((link) => link.targetEntityId === building.id);
    return activeLink
      ? { eligible: false as const, reason: `Already linked to footprint ${activeLink.featureId}` }
      : { eligible: true as const, reason: null };
  };
  const buildingRecordCandidates = (data?.buildings || []).filter((building) => {
    const query = buildingRecordSearch.trim().toLowerCase();
    return !query || `${building.name} ${building.code}`.toLowerCase().includes(query);
  });
  const currentLocations = useMemo(() => overlayChanges(directoryLocations, localLocations), [directoryLocations, localLocations]);
  const currentNodes = useMemo(() => overlayChanges(directoryNodes, localNodes), [directoryNodes, localNodes]);
  const currentPathways = useMemo(() => {
    const merged = overlayChanges(directoryPathways, localPathways);
    return mode === "path" && editingPathId ? merged.map((item) => item.id === editingPathId ? { ...item, pathPoints } : item) : merged;
  }, [directoryPathways, editingPathId, localPathways, mode, pathPoints]);
  const pathwayCrossings = useMemo(
    () => findPathwayCrossings(currentPathways, currentNodes),
    [currentNodes, currentPathways],
  );
  const currentBuildings = useMemo(() => {
    const merged = overlayChanges(directoryBuildings, localBuildings);
    if (mode !== "area" || points.length === 0) return merged;
    const pending: Building = { id: editingBuildingId ?? "pending-building", name: buildingName, code: buildingCode, points };
    return editingBuildingId && merged.some((building) => building.id === editingBuildingId)
      ? merged.map((building) => building.id === editingBuildingId ? pending : building)
      : [...merged, pending];
  }, [buildingCode, buildingName, directoryBuildings, editingBuildingId, localBuildings, mode, points]);
  const pointSnapTargets = useMemo<PointSnapTarget[]>(() => [
    ...currentBuildings.flatMap((building) => building.points.map((point, index) => ({
      kind: "building_perimeter" as const,
      start: point,
      end: building.points[(index + 1) % building.points.length],
    }))),
    ...currentPathways.flatMap((pathway) => {
      const source = currentNodes.find((node) => node.id === pathway.sourceNodeId);
      const destination = currentNodes.find((node) => node.id === pathway.destinationNodeId);
      return [
        ...(source && !(mode === "move" && movingType === "node" && source.id === movingId)
          ? [[source.lat, source.lng] as MapPoint]
          : []),
        ...pathway.pathPoints,
        ...(destination && !(mode === "move" && movingType === "node" && destination.id === movingId)
          ? [[destination.lat, destination.lng] as MapPoint]
          : []),
      ].map((point) => ({ kind: "pathway_vertex" as const, point }));
    }),
  ], [currentBuildings, currentNodes, currentPathways, mode, movingId, movingType]);
  const normalizedLocalFeatures = useMemo(
    () => normalizeMapLayers({
      buildings: currentBuildings,
      locations: currentLocations,
      routeNodes: currentNodes,
      pathways: currentPathways,
    }).localFeatures,
    [currentBuildings, currentLocations, currentNodes, currentPathways],
  );
  const currentLocalFeatures = useMemo(
    () => overlayChanges(authoritativeLayers?.localFeatures ?? normalizedLocalFeatures, localFeatureChanges),
    [authoritativeLayers, localFeatureChanges, normalizedLocalFeatures],
  );
  const canvasLocalFeatures = currentLocalFeatures.filter((feature) =>
    feature.family !== "building_footprint");
  const selectedLocalFeatureDefinition = EDITABLE_LOCAL_FEATURE_FAMILIES.find(
    (family) => family.id === selectedLocalFeatureFamily,
  )!;
  const localFeatureMinimumPoints = selectedLocalFeatureDefinition.geometryType === "line" ? 2 : 3;
  const canCreateLocalFeature = selectedLocalFeatureFamily === "building_footprint"
    || (localFeatureName.trim().length > 0 && localFeaturePoints.length >= localFeatureMinimumPoints);
  const displaysOsmOverlays = [...currentBuildings, ...currentLocations, ...currentNodes, ...currentPathways]
    .some((item) => item.source?.provider === "OpenStreetMap");
  const campusBoundary = useMemo(() => {
    const bootstrapRing = draftBootstrap?.campusBoundary.coordinates[0];
    if (bootstrapRing && bootstrapRing.length >= 3) {
      return bootstrapRing.map(([lng, lat]) => [lat, lng] as MapPoint);
    }
    return directoryBuildings.find((building) => building.code === "CAMPUS_00" || /whole isu campus/i.test(building.name))?.points ?? echagueCampusBoundary;
  }, [directoryBuildings, draftBootstrap?.campusBoundary]);
  const navigationBounds = useMemo(() => {
    const bounds = paddedCampusBounds(campusBoundary);
    return [[bounds.south, bounds.west], [bounds.north, bounds.east]] as [[number, number], [number, number]];
  }, [campusBoundary]);
  const draftReview = useMemo(() => reviewMapDraft({
    original: { locations: directoryLocations, nodes: directoryNodes, pathways: directoryPathways, buildings: directoryBuildings },
    current: { locations: currentLocations, nodes: currentNodes, pathways: currentPathways, buildings: currentBuildings },
    deleted: [],
    campusBoundary,
  }), [campusBoundary, currentBuildings, currentLocations, currentNodes, currentPathways, directoryBuildings, directoryLocations, directoryNodes, directoryPathways]);

  const outsideBoundaryCount = useMemo(() => {
    const locations = currentLocations.filter((item) => isPositionedLocation(item) && !pointOnCampus([item.lat, item.lng], campusBoundary)).length;
    const nodes = currentNodes.filter((item) => !pointOnCampus([item.lat, item.lng], campusBoundary)).length;
    const pathways = currentPathways.filter((item) => {
      const source = currentNodes.find((node) => node.id === item.sourceNodeId);
      const destination = currentNodes.find((node) => node.id === item.destinationNodeId);
      return !geometryOnCampus([
        ...(source ? [[source.lat, source.lng] as [number, number]] : []),
        ...item.pathPoints,
        ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
      ], campusBoundary);
    }).length;
    const buildings = currentBuildings.filter((item) => !geometryOnCampus(item.points, campusBoundary)).length;
    return locations + nodes + pathways + buildings;
  }, [campusBoundary, currentBuildings, currentLocations, currentNodes, currentPathways]);

  // Mode-driven dynamic filtering & viewport culling for fast, lag-free rendering
  const filteredBuildings = useMemo(() => {
    return currentBuildings;
  }, [currentBuildings]);

  const filteredLocations = useMemo(() => {
    const positioned = currentLocations.filter(isPositionedLocation);
    if (mode === "area") return [];
    return positioned.filter(
      (loc) => isPointInBounds(loc.lat, loc.lng, currentMapBounds) || selected?.id === loc.id
    );
  }, [currentLocations, currentMapBounds, mode, selected?.id]);

  const filteredNodes = useMemo(() => {
    if (mode === "place" || mode === "area") return [];
    return currentNodes.filter(
      (node) => isPointInBounds(node.lat, node.lng, currentMapBounds) || selected?.id === node.id
    );
  }, [currentMapBounds, currentNodes, mode, selected?.id]);

  const filteredPathways = useMemo(() => {
    if (mode === "area") return [];
    return currentPathways;
  }, [currentPathways, mode]);

  const selectedLocation =
    currentLocations.find((item) => item.id === selected?.id);
  const selectedNode =
    currentNodes.find((item) => item.id === selected?.id);
  const selectedPath =
    currentPathways.find((item) => item.id === selected?.id);
  const selectedBuilding =
    currentBuildings.find((item) => item.id === selected?.id);
  const selectedLocalFeature =
    currentLocalFeatures.find((item) => item.id === selected?.id);
  const movingObjectName = movingType === "location"
    ? selectedLocation?.name ?? "Location"
    : selectedNode?.name ?? "Route Node";
  const movingOutsideBoundary = Boolean(
    mode === "move" && temporary && !pointOnCampus(temporary, campusBoundary),
  );
  const moveDistanceMeters = moveOrigin && temporary
    ? distanceInMeters(moveOrigin, temporary)
    : 0;
  const selectedBuildingLocation = selectedBuilding && currentLocations.find((location) =>
    location.type === "Building" && (location.id === selectedBuilding.id || location.name === selectedBuilding.name));
  const selectedBuildingAssociationId = selectedBuildingLocation?.id ?? selectedBuilding?.id;
  const selectedBuildingEntrances = selectedBuilding
    ? currentNodes.filter((node) => node.nodeType === "Entrance" && (node.associatedPlaceId === selectedBuilding.id || node.associatedPlaceId === selectedBuildingAssociationId))
    : [];
  const selectedBuildingHasFootprint = Boolean(
    selectedBuilding && currentFeatureLinks.some((link) => link.targetEntityId === selectedBuilding.id),
  );
  const selectedBuildingRoutable = Boolean(selectedBuilding && selectedBuilding.points.length >= 3 &&
    selectedBuildingLocation?.status === "Active" && selectedBuildingLocation.positioned && selectedBuildingEntrances.some((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng)));

  useEffect(() => {
    const locationId = new URLSearchParams(routeLocation.search).get(
      "location",
    );
    if (locationId && directoryLocations.some((item) => item.id === locationId)) {
      const loc = directoryLocations.find((item) => item.id === locationId);
      setSelected({ type: "location", id: locationId });
      setPlacingId(locationId);
      setPlacingObjectType("location");
      setMode("place");
      if (loc && isPositionedLocation(loc)) {
        setFlyTarget([loc.lat, loc.lng]);
      }
    }
  }, [directoryLocations, routeLocation.search]);

  useEffect(() => {
    const pathwayId = new URLSearchParams(routeLocation.search).get("pathway");
    if (!pathwayId) return;
    if (!data) return;
    const pathway = localPathways.find((item) => item.id === pathwayId)
      ?? directoryPathways.find((item) => item.id === pathwayId);
    if (!pathway) {
      setError("The requested Pathway is no longer available. Refresh the Routes list and try again.");
      return;
    }
    setSelected({ type: "pathway", id: pathway.id });
    setEditingPathId(pathway.id);
    setPathPoints([...pathway.pathPoints]);
    setMode("path");
    setError("");
    const source = currentNodes.find((node) => node.id === pathway.sourceNodeId);
    if (source) setFlyTarget([source.lat, source.lng]);
  }, [currentNodes, data, directoryPathways, localPathways, routeLocation.search]);

  useEffect(() => {
    if (directoryLocations.length > 0 && !placingId) {
      setPlacingId(directoryLocations[0].id);
    }
  }, [directoryLocations, placingId]);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const allLocs = directoryLocations.length ? directoryLocations : localLocations;
    const allNodes = directoryNodes.length ? directoryNodes : localNodes;
    const allPaths = directoryPathways.length ? directoryPathways : localPathways;

    const matchedLocs = allLocs
      .filter((l) => l.name.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Location" as const }));
    const matchedNodes = allNodes
      .filter((n) => n.name.toLowerCase().includes(q) || n.nodeType.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Route Node" as const }));
    const matchedPaths = allPaths
      .filter((p) => p.name.toLowerCase().includes(q) || p.shade.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Pathway" as const }));
    return [...matchedLocs, ...matchedNodes, ...matchedPaths].slice(0, 8);
  }, [directoryLocations, directoryNodes, directoryPathways, localLocations, localNodes, localPathways, search]);

  const selectObject = useCallback(
    (type: "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature", id: string) => {
      setSelected({ type, id });
      setLocalFeatureActionNotice("");
      if (type === "pathway") {
        const path = localPathways.find((p) => p.id === id) || directoryPathways.find((p) => p.id === id);
        if (path) {
          setEditingPathId(path.id);
          setPathPoints(path.pathPoints || []);
        }
      }
      setTemporary(null);
    },
    [directoryPathways, localPathways],
  );

  const handleSearchResultClick = (item: {
    id: string;
    kind: "Location" | "Route Node" | "Pathway";
    lat?: number | null;
    lng?: number | null;
  }) => {
    if (item.kind === "Location") {
      selectObject("location", item.id);
      const loc = directoryLocations.find((l) => l.id === item.id) || localLocations.find((l) => l.id === item.id);
      if (loc && isPositionedLocation(loc)) setFlyTarget([loc.lat, loc.lng]);
    } else if (item.kind === "Route Node") {
      selectObject("node", item.id);
      const n = directoryNodes.find((node) => node.id === item.id) || localNodes.find((node) => node.id === item.id);
      if (n) setFlyTarget([n.lat, n.lng]);
    } else if (item.kind === "Pathway") {
      selectObject("pathway", item.id);
      const p = directoryPathways.find((path) => path.id === item.id) || localPathways.find((path) => path.id === item.id);
      if (p) {
        const src = directoryNodes.find((n) => n.id === p.sourceNodeId) || localNodes.find((n) => n.id === p.sourceNodeId);
        if (src) setFlyTarget([src.lat, src.lng]);
      }
    }
    setSearch("");
  };

  const onMapClick = (point: [number, number]) => {
    if (mode !== "area" && mode !== "move" && !pointOnCampus(point, campusBoundary)) {
      setError("New or modified geometry must stay inside the ISU Echague campus boundary.");
      return;
    }
    setError("");
    if (mode === "area") {
      if (polygonInteraction !== "draw" || polygonClosed) return;
      const nextPoints = [...points, point];
      setPoints(nextPoints);
    } else if (mode === "local_feature") {
      setLocalFeaturePoints((current) => [...current, point]);
    } else if (mode === "place" || mode === "move") {
      setTemporary(point);
      setPointIsSnapped(false);
      setPointDraftDirty(true);
      if (mode === "place" && placingObjectType === "location" && placingId === "__new__") setAddLocationOpen(true);
    } else if (mode === "path" && editingPathId && !manualPathPointDrag) {
      setPathPoints((current) => [...current, point]);
      setPathDraftDirty(true);
    }
  };

  const closePolygon = useCallback(() => {
    if (mode !== "area" || polygonInteraction !== "draw" || points.length < 3) return;
    if (polygonSelfIntersects(points)) {
      setError("Cannot close the footprint while its edges intersect.");
      return;
    }
    setPolygonClosed(true);
    setBuildingRecordMode("create");
    setError("");
  }, [mode, points, polygonInteraction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") closePolygon();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePolygon]);

  const updatePolygonVertex = (index: number, point: [number, number]) => {
    setPoints((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate));
  };

  const insertPolygonVertex = (index: number) => {
    setPoints((current) => {
      const next = current[(index + 1) % current.length];
      const point: [number, number] = [(current[index][0] + next[0]) / 2, (current[index][1] + next[1]) / 2];
      return [...current.slice(0, index + 1), point, ...current.slice(index + 1)];
    });
  };

  const deletePolygonVertex = (index: number) => {
    if (points.length <= 3) return;
    setPoints((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  };

  const movePolygon = (point: [number, number]) => {
    if (!points.length) return;
    const anchor = polygonFeatureAnchor(points);
    const delta: [number, number] = [point[0] - anchor[0], point[1] - anchor[1]];
    const translated = translatePolygon(points, delta);
    if (geometryOnCampus(translated, campusBoundary)) setPoints(translated);
    else setError("The building footprint must stay inside the ISU Echague campus boundary.");
  };

  const handleStartMoveMarker = () => {
    if (!selectedLocation) return;
    setMovingType("location");
    setMovingId(selectedLocation.id);
    if (!isPositionedLocation(selectedLocation)) return;
    const origin: MapPoint = [selectedLocation.lat, selectedLocation.lng];
    setMoveOrigin(origin);
    setLastValidMovePosition(origin);
    setTemporary(origin);
    setPointIsSnapped(false);
    setMoveDropRejected(false);
    setPointDraftDirty(false);
    setMode("move");
  };

  const handleStartMoveNode = () => {
    if (!selectedNode) return;
    setMovingType("node");
    setMovingId(selectedNode.id);
    const origin: MapPoint = [selectedNode.lat, selectedNode.lng];
    setMoveOrigin(origin);
    setLastValidMovePosition(origin);
    setTemporary(origin);
    setPointIsSnapped(false);
    setMoveDropRejected(false);
    setPointDraftDirty(false);
    setMode("move");
  };

  const updateMovePosition = (point: MapPoint, snapped = false) => {
    setTemporary(point);
    if (pointOnCampus(point, campusBoundary)) setLastValidMovePosition(point);
    setPointIsSnapped(snapped);
    setMoveDropRejected(false);
    setPointDraftDirty(true);
    setError("");
  };

  const handleRejectedPointDrop = () => {
    setTemporary(lastValidMovePosition ?? moveOrigin);
    setPointIsSnapped(false);
    setMoveDropRejected(true);
    setError("");
  };

  const handleCancelMove = () => {
    setTemporary(null);
    setMoveOrigin(null);
    setLastValidMovePosition(null);
    setPointIsSnapped(false);
    setMoveDropRejected(false);
    setIsPointDragging(false);
    setPointDraftDirty(false);
    setError("");
    setMode("select");
    workingSessionManager.discardActiveDraft();
  };

  const handleSavePosition = () => {
    if (!temporary) return;
    if (!pointOnCampus(temporary, campusBoundary)) {
      setError("The new position must stay inside the ISU Echague campus boundary.");
      return;
    }
    if (movingType === "location" && movingId) {
      const existing = currentLocations.find((location) => location.id === movingId);
      const updated = existing ? { ...existing, lat: temporary[0], lng: temporary[1], positioned: true } : null;
      if (updated) {
        setLocalLocations((current) => {
          const filtered = current.filter((l) => l.id !== movingId);
          return [...filtered, updated];
        });
        workingSessionManager.executeOperation({
          type: "update_geometry",
          domain: "Locations",
          entityId: movingId,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          description: `Move ${updated.name}`,
        });
      }
      setDirty(true);
      setMode("select");
      setSelected({ type: "location", id: movingId });
      completeToolDraft("point");
    } else if (movingType === "node" && movingId) {
      const existing = currentNodes.find((node) => node.id === movingId);
      const updated = existing ? { ...existing, lat: temporary[0], lng: temporary[1] } : null;
      if (updated) {
        setLocalNodes((current) => {
          const filtered = current.filter((n) => n.id !== movingId);
          return [...filtered, updated];
        });
        workingSessionManager.executeOperation({
          type: "update_geometry",
          domain: "Routes & Paths",
          entityId: movingId,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          description: `Move ${updated.name}`,
        });
      }
      setDirty(true);
      setMode("select");
      setSelected({ type: "node", id: movingId });
      completeToolDraft("point");
    }
    setTemporary(null);
    setMoveOrigin(null);
    setPointIsSnapped(false);
    setIsPointDragging(false);
  };

  const handleSavePlacedMarker = async () => {
    if (!temporary || !placingId) return;
    if (!pointOnCampus(temporary, campusBoundary)) {
      setError("The new position must stay inside the ISU Echague campus boundary.");
      return;
    }
    const target = directoryLocations.find((l) => l.id === placingId);
    if (target) {
      const updated = { ...target, lat: temporary[0], lng: temporary[1], positioned: true };
      setLocalLocations((current) => [...current.filter((item) => item.id !== target.id), updated]);
      setMode("select");
      setSelected({ type: "location", id: placingId });
      setTemporary(null);
      setDirty(true);
      completeToolDraft("point");
    }
  };

  const handleSavePlacedNode = () => {
    if (!temporary || !placingNodeName.trim()) return;
    if (!pointOnCampus(temporary, campusBoundary)) {
      setError("The new position must stay inside the ISU Echague campus boundary.");
      return;
    }
    const newNodeId = `node-${Date.now()}`;
    const newNode: RouteNode = {
      id: newNodeId,
      name: placingNodeName.trim(),
      nodeType: placingNodeType,
      associatedPlaceId: placingAssociatedPlaceId || null,
      lat: temporary[0],
      lng: temporary[1],
    };
    setLocalNodes((current) => [...current, newNode]);
    if (newNode.nodeType === "Entrance" && newNode.associatedPlaceId === nonRoutableBuildingId) {
      setNonRoutableBuildingId(null);
    }
    setDirty(true);
    setPlacingNodeName("");
    setMode("select");
    setSelected({ type: "node", id: newNodeId });
    completeToolDraft("point");
  };

  const handleSaveNewLocation = () => {
    if (!newLocation.name.trim() || !newLocation.code.trim()) return;
    const location: Location = { id: `location-${Date.now()}`, ...newLocation, lat: temporary?.[0] ?? null, lng: temporary?.[1] ?? null, positioned: Boolean(temporary) };
    setLocalLocations((current) => [...current, location]);
    setDirty(true); setAddLocationOpen(false); setTemporary(null); setMode("select"); setSelected({ type: "location", id: location.id });
    completeToolDraft("point");
  };

  const handleSavePathShape = () => {
    if (!editingPathId) return;
    const target = localPathways.find((pathway) => pathway.id === editingPathId) || directoryPathways.find((pathway) => pathway.id === editingPathId);
    if (target) {
      const updatedPath: Pathway = {
        ...target,
        // A Pathway owns only intermediate geometry. Endpoint coordinates are
        // always read from the selected Route Nodes.
        pathPoints: withoutEndpointPathPoints(
          [...pathPoints],
          routeNodePoint(currentNodes, target.sourceNodeId),
          routeNodePoint(currentNodes, target.destinationNodeId),
        ),
      };
      setLocalPathways((current) => {
        const filtered = current.filter((p) => p.id !== editingPathId);
        return [...filtered, updatedPath];
      });
      const src = directoryNodes.find((n) => n.id === target.sourceNodeId);
      const dst = directoryNodes.find((n) => n.id === target.destinationNodeId);
      if (src && !localNodes.some((n) => n.id === src.id)) setLocalNodes((c) => [...c, src]);
      if (dst && !localNodes.some((n) => n.id === dst.id)) setLocalNodes((c) => [...c, dst]);
    }
    setDirty(true);
    setMode("select");
    completeToolDraft("pathway");
  };

  const handleSaveBuilding = () => {
    if (!canSaveBuilding) return;
    if (!geometryOnCampus(points, campusBoundary)) {
      setError("The building footprint must stay inside the ISU Echague campus boundary.");
      return;
    }
    const building: Building = {
      id: editingBuildingId ?? `building-${Date.now()}`,
      name: buildingName.trim(),
      code: buildingCode.trim(),
      points: [...points],
    };
    setLocalBuildings((current) => [...current.filter((item) => item.id !== building.id), building]);
    setDirty(true);
    setPoints([]);
    setBuildingName("");
    setBuildingCode("");
    setEditingBuildingId(null);
    setBuildingRecordMode("create");
    setMode("select");
    setSelected({ type: "building", id: building.id });
    setPlacingAssociatedPlaceId(building.id);
    completeToolDraft("polygon");
  };

  const completeBuildingRecordWorkflow = (buildingRecord: Building, intent: "create" | "attach") => {
    const featureId = `feat-poly-${buildingRecord.id}`;
    const link: FeatureLinkEntity = {
      id: `link-${featureId}-${buildingRecord.id}`,
      featureId,
      targetDomain: "Locations",
      targetEntityId: buildingRecord.id,
      linkType: "building_footprint",
    };
    const footprint: LocalMapFeatureEntity = {
      id: featureId,
      family: "building_footprint",
      name: `${buildingRecord.name} footprint`,
      isEditable: true,
      status: "active",
      geometryType: "polygon",
      coordinates: [...points],
      linkedBuildingId: buildingRecord.id,
    };
    const nestedOperations: WorkingOperation[] = [
      {
        id: `create-${featureId}`,
        type: "create_entity",
        domain: "Local Map Data",
        entityId: featureId,
        before: null,
        after: footprint as unknown as Record<string, unknown>,
        description: `Create ${footprint.name}`,
      },
      ...(intent === "create" ? [{
        id: `create-${buildingRecord.id}`,
        type: "create_entity" as const,
        domain: "Locations" as const,
        entityId: buildingRecord.id,
        before: null,
        after: buildingRecord as unknown as Record<string, unknown>,
        description: `Create ${buildingRecord.name}`,
      }] : []),
      {
        id: `create-${link.id}`,
        type: "link_feature",
        domain: "Local Map Data",
        entityId: link.id,
        before: null,
        after: link as unknown as Record<string, unknown>,
        description: `Link footprint to ${buildingRecord.name}`,
      },
    ];

    // The current renderer still consumes Building.points. Keep this local
    // compatibility projection separate from the geometry-free Building
    // record stored in the compound operation above.
    const renderedBuilding = { ...buildingRecord, points: [...points] };
    setLocalBuildings((current) => [...current.filter((item) => item.id !== buildingRecord.id), renderedBuilding]);
    setLocalFeatureChanges((current) => [...current.filter((item) => item.id !== featureId), footprint]);
    setLocalFeatureLinks((current) => [...current.filter((item) => item.targetEntityId !== buildingRecord.id), link]);
    workingSessionManager.executeBatch(
      intent === "create" ? `Create ${buildingRecord.name} with footprint` : `Attach footprint to ${buildingRecord.name}`,
      "Local Map Data",
      featureId,
      nestedOperations,
    );
    setDirty(true);
    setPoints([]);
    setBuildingName("");
    setBuildingCode("");
    setBuildingRecordSearch("");
    setSelectedBuildingRecordId(null);
    setPolygonClosed(false);
    setMode("select");
    setSelected({ type: "building", id: buildingRecord.id });
    setPlacingAssociatedPlaceId(buildingRecord.id);
    const hasActiveEntrance = currentNodes.some((node) =>
      node.nodeType === "Entrance"
      && node.associatedPlaceId === buildingRecord.id
      && node.status !== "Inactive",
    );
    setNonRoutableBuildingId(hasActiveEntrance ? null : buildingRecord.id);
    completeToolDraft("polygon");
  };

  const handleCreateBuildingRecord = () => {
    if (!canSaveBuilding || !geometryOnCampus(points, campusBoundary)) return;
    completeBuildingRecordWorkflow({
      id: `building-${Date.now()}`,
      name: buildingName.trim(),
      code: buildingCode.trim(),
      points: [],
    }, "create");
  };

  const handleAttachBuildingRecord = () => {
    const existing = (data?.buildings || []).find((building) => building.id === selectedBuildingRecordId);
    if (!existing || !buildingAttachmentEligibility(existing).eligible) return;
    completeBuildingRecordWorkflow(existing, "attach");
  };

  const startGuidedEntranceDraft = () => {
    const building = currentBuildings.find((candidate) => candidate.id === nonRoutableBuildingId);
    if (!building) return;
    setPlacingObjectType("node");
    setPlacingNodeType("Entrance");
    setPlacingNodeName(`${building.name} Entrance`);
    setPlacingAssociatedPlaceId(building.id);
    setTemporary(null);
    setPointDraftDirty(false);
    setMode("place");
  };

  const resetDraft = () => {
    setLocalLocations([]);
    setLocalNodes([]);
    setLocalPathways([]);
    setLocalBuildings([]);
    setLocalFeatureChanges([]);
    setLocalFeatureLinks([]);
    setUnlinkedFeatureLinkIds([]);
    setLocalFeaturePoints([]);
    setLocalFeatureName("New Parking Area");
    setOwnerModal(null);
    setDirty(false);
    setTemporary(null);
    setPointDraftDirty(false);
    setPoints([]);
    setPolygonClosed(false);
    setBuildingRecordMode("create");
    setBuildingRecordSearch("");
    setSelectedBuildingRecordId(null);
    setNonRoutableBuildingId(null);
    setPathPoints([]);
    setEditingPathId(null);
    setProvisionalPathwayId(null);
    setPathStartNodeId(null);
    setPathDraftDirty(false);
    setEditingBuildingId(null);
    setConfirm(null);
    setPreviewOpen(false);
    setError("");
    setMode("select");
    setSelected(null);
    workingSessionManager.reset();
  };

  const updateLocation = (updated: Location) => { setLocalLocations((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updateNode = (updated: RouteNode) => { setLocalNodes((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updatePathway = (updated: Pathway) => { setLocalPathways((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updateBuilding = (updated: Building) => { setLocalBuildings((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const focusObject = (object: MapObjectReference, fieldLabel?: string) => {
    setPreviewOpen(false);
    setSelected({ type: object.type, id: object.id });
    if (fieldLabel) {
      if (object.type === "building" || object.type === "location") setOwnerModal("location");
      if (object.type === "node" || object.type === "pathway") setOwnerModal("route");
      window.setTimeout(() => document.querySelector<HTMLElement>(`[aria-label="${fieldLabel}"]`)?.focus());
    }
    if (object.type === "pathway") {
      const pathway = currentPathways.find((item) => item.id === object.id);
      if (pathway) {
        setEditingPathId(pathway.id);
        setPathPoints(pathway.pathPoints);
      }
    }
    const positioned = currentLocations.find((item) => item.id === object.id);
    if (positioned && isPositionedLocation(positioned)) setFlyTarget([positioned.lat, positioned.lng]);
    const positionedNode = currentNodes.find((item) => item.id === object.id);
    if (positionedNode) setFlyTarget([positionedNode.lat, positionedNode.lng]);
    if (object.type === "pathway") {
      const pathway = currentPathways.find((item) => item.id === object.id);
      const source = pathway && currentNodes.find((item) => item.id === pathway.sourceNodeId);
      if (source) setFlyTarget([source.lat, source.lng]);
    }
    if (object.type === "building") {
      const building = currentBuildings.find((item) => item.id === object.id);
      if (building?.points[0]) setFlyTarget(building.points[0]);
    }
  };

  const openSaveReview = () => {
    if (!draftReview.valid) {
      setPreviewOpen(true);
      return;
    }
    setConfirm("save");
  };

  const commit = async () => {
    if (confirm === "discard") {
      if (draftVersion === null) return;
      setLifecycleBusy(true);
      try {
        const result = await mapEditorApiClient.discardDraft(MAP_EDITOR_PROJECT_ID, draftVersion);
        if (!result.success) throw new Error("Unable to discard the Admin Draft.");
        const baseline = await mapEditorApiClient.getMapEditorBootstrap(MAP_EDITOR_PROJECT_ID);
        resetDraft();
        setDraftVersion(baseline.adminDraft.draftVersion);
        setPublishedVersionId(baseline.publishedVersionId);
        setAuthoritativeLayers(baseline.layers);
        queryClient.setQueryData(["map-editor-bootstrap", MAP_EDITOR_PROJECT_ID], baseline);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to discard the Admin Draft.");
      } finally {
        setLifecycleBusy(false);
      }
      return;
    }
    if (confirm === "publish") {
      if (draftVersion === null) return;
      setLifecycleBusy(true);
      try {
        const result = await mapEditorApiClient.publishDraft(MAP_EDITOR_PROJECT_ID, draftVersion);
        if (!result.success) throw new Error(result.warnings?.join(" ") || "Draft validation failed.");
        setPublishedVersionId(result.newPublishedVersionId);
        setConfirm(null);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to publish the Admin Draft.");
      } finally {
        setLifecycleBusy(false);
      }
      return;
    }
    if (draftVersion === null) return;
    try {
      setLifecycleBusy(true);
      const result = await mapEditorApiClient.saveDraft(
        MAP_EDITOR_PROJECT_ID,
        draftVersion,
        workingSessionManager.getUncommittedOperations(),
      );
      if (!result.success) {
        if (result.errorType === "CONCURRENCY_CONFLICT") {
          setConflictReview({
            entities: result.conflictingEntities,
            serverDraftVersion: result.currentServerDraftVersion,
          });
          setConfirm(null);
          return;
        }
        throw new Error(result.message);
      }
      setDraftVersion(result.newDraftVersion);
      workingSessionManager.markSaved();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["map"] }),
        queryClient.invalidateQueries({ queryKey: ["routes"] }),
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
      ]);
      setDirty(false);
      setConfirm(null);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save map changes.",
      );
    } finally {
      setLifecycleBusy(false);
    }
  };

  const activePathway = directoryPathways.find((p) => p.id === editingPathId) || localPathways.find((p) => p.id === editingPathId);

  const startNewPathway = () => {
    setEditingPathId(null);
    setProvisionalPathwayId(null);
    setPathStartNodeId(null);
    setPathPoints([]);
    setSelected(null);
    setPathDraftDirty(false);
    setMode("path");
  };

  const insertPathPoint = (segmentIndex: number) => {
    if (!activePathway) return;
    const source = currentNodes.find((node) => node.id === activePathway.sourceNodeId);
    const destination = currentNodes.find((node) => node.id === activePathway.destinationNodeId);
    if (!source || !destination) return;
    const coordinates = [
      { latitude: source.lat, longitude: source.lng },
      ...pathPoints.map(([latitude, longitude]) => ({ latitude, longitude })),
      { latitude: destination.lat, longitude: destination.lng },
    ];
    const withMidpoint = insertPathPointAtSegmentMidpoint(coordinates, segmentIndex);
    setPathPoints(withMidpoint.slice(1, -1).map(({ latitude, longitude }) => [latitude, longitude]));
    setSelectedPathPointIndex(segmentIndex);
    setPathDraftDirty(true);
  };

  const createJunctionAtCrossing = () => {
    const crossing = pathwayCrossings[0];
    if (!crossing) return;
    const pathwayA = currentPathways.find((pathway) => pathway.id === crossing.pathwayAId);
    const pathwayB = currentPathways.find((pathway) => pathway.id === crossing.pathwayBId);
    if (!pathwayA || !pathwayB) return;
    const junctionId = `junction-${Date.now()}`;
    const crossingChange = createRoutableCrossing(pathwayA, pathwayB, currentNodes, crossing.point, junctionId);
    setLocalNodes((current) => [...current.filter((node) => node.id !== junctionId), crossingChange.junction]);
    setLocalPathways((current) => [
      ...current.filter((pathway) =>
        !crossingChange.closedPathways.some((closed) => closed.id === pathway.id)
        && !crossingChange.replacementPathways.some((replacement) => replacement.id === pathway.id)),
      ...crossingChange.closedPathways,
      ...crossingChange.replacementPathways,
    ]);
    workingSessionManager.executeBatch(
      `Create Junction and split ${pathwayA.name} with ${pathwayB.name}`,
      "Routes & Paths",
      junctionId,
      crossingChange.operations,
    );
    setEditingPathId(null);
    setPathPoints([]);
    setSelected({ type: "node", id: junctionId });
    setMode("select");
    setDirty(true);
    completeToolDraft("pathway");
  };

  const activeTool: ToolType = mode === "place" || mode === "move"
    ? "point"
    : mode === "area"
      ? "polygon"
      : mode === "path"
        ? "pathway"
        : mode;

  const draftSnapshot = useMemo<Omit<ActiveToolDraft, "id" | "isSuspended"> | null>(() => {
    if (activeTool === "point" && temporary && pointDraftDirty) {
      return {
        toolType: "point",
        label: "Point Location draft",
        provisionalGeometry: {
          points: [{ x: temporary[1], y: temporary[0], lat: temporary[0], lng: temporary[1] }],
        },
        nestedRecords: {
          editorMode: mode,
          placingObjectType,
          placingId,
          placingNodeType,
          placingNodeName,
          placingAssociatedPlaceId,
          movingType,
          movingId,
          addLocationOpen,
          newLocation,
          selected,
        },
      };
    }
    if (activeTool === "polygon" && points.length > 0) {
      return {
        toolType: "polygon",
        label: "Building Polygon draft",
        provisionalGeometry: {
          points: points.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
          isClosed: polygonClosed,
        },
        nestedRecords: { buildingName, buildingCode, editingBuildingId, polygonClosed },
      };
    }
    if (activeTool === "pathway" && (pathStartNodeId || pathDraftDirty)) {
      return {
        toolType: "pathway",
        label: "Pathway draft",
        provisionalGeometry: {
          points: pathPoints.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
          startNodeId: pathStartNodeId ?? activePathway?.sourceNodeId,
          endNodeId: activePathway?.destinationNodeId,
        },
        nestedRecords: {
          editingPathId,
          selectedPathPointIndex,
          manualPathPointDrag,
          provisionalPathwayId,
          provisionalPathway: provisionalPathwayId
            ? localPathways.find((pathway) => pathway.id === provisionalPathwayId) ?? null
            : null,
        },
      };
    }
    if (activeTool === "local_feature" && localFeaturePoints.length > 0) {
      return {
        toolType: "local_feature",
        label: `${selectedLocalFeatureDefinition.label} draft`,
        provisionalGeometry: {
          points: localFeaturePoints.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
          isClosed: selectedLocalFeatureDefinition.geometryType === "polygon",
        },
        nestedRecords: {
          family: selectedLocalFeatureFamily,
          name: localFeatureName,
        },
      };
    }
    return null;
  }, [
    activePathway?.destinationNodeId,
    activePathway?.sourceNodeId,
    activeTool,
    addLocationOpen,
    buildingCode,
    buildingName,
    editingBuildingId,
    editingPathId,
    localPathways,
    localFeatureName,
    localFeaturePoints,
    manualPathPointDrag,
    mode,
    movingId,
    movingType,
    pathDraftDirty,
    pathPoints,
    polygonClosed,
    pathStartNodeId,
    pointDraftDirty,
    placingAssociatedPlaceId,
    placingId,
    placingNodeName,
    placingNodeType,
    placingObjectType,
    points,
    provisionalPathwayId,
    newLocation,
    selected,
    selectedLocalFeatureDefinition.geometryType,
    selectedLocalFeatureDefinition.label,
    selectedLocalFeatureFamily,
    selectedPathPointIndex,
    temporary,
  ]);

  useEffect(() => {
    const activeDraft = workingSessionManager.getActiveDraft();
    if (!draftSnapshot) {
      if (activeDraft && (activeDraft.toolType === activeTool || activeTool === "select")) {
        workingSessionManager.discardActiveDraft();
      }
      return;
    }
    if (!activeDraft) {
      workingSessionManager.startDraft(draftSnapshot);
    } else if (activeDraft.toolType === draftSnapshot.toolType) {
      workingSessionManager.updateDraft(draftSnapshot);
    }
  }, [activeTool, draftSnapshot, workingSessionManager]);

  const clearDraftGeometry = (toolType: Exclude<ToolType, "select">) => {
    if (toolType === "point") {
      setTemporary(null);
      setPointDraftDirty(false);
      setAddLocationOpen(false);
      return;
    }
    if (toolType === "polygon") {
      setPoints([]);
      setPolygonClosed(false);
      setBuildingRecordMode("create");
      setBuildingRecordSearch("");
      setSelectedBuildingRecordId(null);
      setBuildingName("");
      setBuildingCode("");
      setEditingBuildingId(null);
      return;
    }
    if (toolType === "pathway") {
      if (provisionalPathwayId) {
        setLocalPathways((pathways) => pathways.filter((pathway) => pathway.id !== provisionalPathwayId));
      }
      setPathPoints([]);
      setPathStartNodeId(null);
      setEditingPathId(null);
      setProvisionalPathwayId(null);
      setSelectedPathPointIndex(null);
      setManualPathPointDrag(false);
      setPathDraftDirty(false);
      return;
    }
    setLocalFeaturePoints([]);
  };

  const selectLocalFeatureFamily = (family: Exclude<LocalFeatureFamily, "readonly_basemap">) => {
    const definition = EDITABLE_LOCAL_FEATURE_FAMILIES.find((candidate) => candidate.id === family)!;
    setSelectedLocalFeatureFamily(family);
    setLocalFeatureName(family === "campus_boundary" ? "ISU Echague Campus Perimeter" : `New ${definition.label}`);
    setLocalFeaturePoints([]);
  };

  const createSelectedLocalFeature = () => {
    if (selectedLocalFeatureFamily === "building_footprint") {
      setLocalFeaturePoints([]);
      setMode("area");
      setPolygonInteraction("draw");
      setPolygonClosed(false);
      return;
    }
    if (!canCreateLocalFeature) return;
    const existingBoundary = selectedLocalFeatureFamily === "campus_boundary"
      ? currentLocalFeatures.find((feature) => feature.family === "campus_boundary" && feature.status !== "retired")
      : undefined;
    const feature: LocalMapFeatureEntity = {
      ...(existingBoundary ?? {}),
      id: existingBoundary?.id ?? `local-feature-${Date.now()}`,
      family: selectedLocalFeatureFamily,
      name: localFeatureName.trim(),
      isEditable: true,
      geometryType: selectedLocalFeatureDefinition.geometryType,
      coordinates: [...localFeaturePoints],
      surface: existingBoundary?.surface ?? "unknown",
      access: existingBoundary?.access ?? "unknown",
      direction: selectedLocalFeatureDefinition.geometryType === "line"
        ? existingBoundary?.direction ?? "both"
        : undefined,
      status: "active",
    };
    setLocalFeatureChanges((items) => [...items.filter((item) => item.id !== feature.id), feature]);
    workingSessionManager.executeOperation({
      type: existingBoundary ? "update_geometry" : "create_entity",
      domain: "Local Map Data",
      entityId: feature.id,
      before: existingBoundary ? existingBoundary as unknown as Record<string, unknown> : null,
      after: feature as unknown as Record<string, unknown>,
      description: existingBoundary
        ? "Replace Campus Boundary geometry"
        : `Create ${selectedLocalFeatureDefinition.label}`,
    });
    setLocalFeaturePoints([]);
    setDirty(true);
    setSelected({ type: "local_feature", id: feature.id });
    setMode("select");
    workingSessionManager.discardActiveDraft();
  };

  const activateTool = (toolType: ToolType) => {
    if (toolType === "select") {
      setMode("select");
      setTemporary(null);
      setPointDraftDirty(false);
      return;
    }
    if (toolType === "point") {
      setMode("place");
      setSelected(null);
      setPlacingId("__new__");
      setPointDraftDirty(false);
      return;
    }
    if (toolType === "polygon") {
      setMode("area");
      setPolygonInteraction("draw");
      setPolygonClosed(false);
      return;
    }
    if (toolType === "pathway") {
      setMode("path");
      if (!editingPathId && (directoryPathways.length || localPathways.length)) {
        const first = localPathways[0] || directoryPathways[0];
        if (first) {
          setEditingPathId(first.id);
          setPathPoints(first.pathPoints || []);
        }
      }
      return;
    }
    setMode("local_feature");
    setSelected(null);
    setLocalFeaturePoints([]);
  };

  const selectTool = (toolType: ToolType) => {
    if (toolType === activeTool) return;
    if (workingSessionManager.hasActiveDraft()) {
      setPendingToolRequest({ toolType });
      return;
    }
    activateTool(toolType);
  };

  const restoreSuspendedDraft = (draftId: string) => {
    const draft = workingSessionManager.resumeSuspendedDraft(draftId);
    if (!draft) return;
    const restoredPoints = (draft.provisionalGeometry.points ?? []).map((point) => [
      point.lat ?? point.y,
      point.lng ?? point.x,
    ] as [number, number]);
    const records = draft.nestedRecords ?? {};

    if (draft.toolType === "point") {
      setTemporary(restoredPoints[0] ?? null);
      setPointDraftDirty(true);
      setMode(records.editorMode === "move" ? "move" : "place");
      if (records.placingObjectType === "location" || records.placingObjectType === "node") setPlacingObjectType(records.placingObjectType);
      if (typeof records.placingId === "string") setPlacingId(records.placingId);
      if (records.placingNodeType === "Entrance" || records.placingNodeType === "Junction" || records.placingNodeType === "Access Point") setPlacingNodeType(records.placingNodeType);
      if (typeof records.placingNodeName === "string") setPlacingNodeName(records.placingNodeName);
      if (typeof records.placingAssociatedPlaceId === "string" || records.placingAssociatedPlaceId === null) setPlacingAssociatedPlaceId(records.placingAssociatedPlaceId);
      if (records.movingType === "location" || records.movingType === "node") setMovingType(records.movingType);
      if (typeof records.movingId === "string" || records.movingId === null) setMovingId(records.movingId);
      setAddLocationOpen(records.addLocationOpen === true);
      if (isNewLocationDraft(records.newLocation)) setNewLocation(records.newLocation);
      const restoredSelection = records.selected;
      if (
        restoredSelection
        && typeof restoredSelection === "object"
        && "type" in restoredSelection
        && "id" in restoredSelection
        && (restoredSelection.type === "location" || restoredSelection.type === "node")
        && typeof restoredSelection.id === "string"
      ) {
        setSelected({ type: restoredSelection.type, id: restoredSelection.id });
      } else {
        setSelected(null);
      }
    } else if (draft.toolType === "polygon") {
      setPoints(restoredPoints);
      setBuildingName(typeof records.buildingName === "string" ? records.buildingName : "");
      setBuildingCode(typeof records.buildingCode === "string" ? records.buildingCode : "");
      setEditingBuildingId(typeof records.editingBuildingId === "string" ? records.editingBuildingId : null);
      setMode("area");
    } else if (draft.toolType === "pathway") {
      setPathPoints(restoredPoints);
      setPathStartNodeId(draft.provisionalGeometry.startNodeId ?? null);
      const restoredPathwayId = typeof records.editingPathId === "string" ? records.editingPathId : null;
      setEditingPathId(restoredPathwayId);
      setSelectedPathPointIndex(typeof records.selectedPathPointIndex === "number" ? records.selectedPathPointIndex : null);
      setManualPathPointDrag(records.manualPathPointDrag === true);
      const restoredProvisionalPathway = isPathwayDraft(records.provisionalPathway)
        ? { ...records.provisionalPathway, pathPoints: restoredPoints }
        : null;
      const restoredProvisionalPathwayId = typeof records.provisionalPathwayId === "string"
        ? records.provisionalPathwayId
        : null;
      setProvisionalPathwayId(restoredProvisionalPathwayId);
      if (restoredProvisionalPathway) {
        setLocalPathways((pathways) => [
          ...pathways.filter((pathway) => pathway.id !== restoredProvisionalPathway.id),
          restoredProvisionalPathway,
        ]);
      }
      setPathDraftDirty(true);
      setMode("path");
    } else {
      const restoredFamily = records.family;
      if (
        restoredFamily === "building_footprint"
        || restoredFamily === "parking_area"
        || restoredFamily === "cartographic_walkway"
        || restoredFamily === "vehicle_path"
        || restoredFamily === "campus_boundary"
      ) setSelectedLocalFeatureFamily(restoredFamily);
      if (typeof records.name === "string") setLocalFeatureName(records.name);
      setLocalFeaturePoints(restoredPoints);
      setMode("local_feature");
    }
  };

  const requestDraftResume = (draftId: string) => {
    const draft = workingSessionManager.getSuspendedDrafts().find((item) => item.id === draftId);
    if (!draft) return;
    if (workingSessionManager.hasActiveDraft()) {
      setPendingToolRequest({ toolType: draft.toolType, resumeDraftId: draftId });
      return;
    }
    restoreSuspendedDraft(draftId);
  };

  const finishInterruption = (action: "keep_draft" | "discard_geometry") => {
    if (!pendingToolRequest) return;
    const currentDraft = workingSessionManager.getActiveDraft();
    if (!currentDraft) return;
    workingSessionManager.handleInterruption(action);
    clearDraftGeometry(currentDraft.toolType);
    const request = pendingToolRequest;
    setPendingToolRequest(null);
    if (request.resumeDraftId) restoreSuspendedDraft(request.resumeDraftId);
    else activateTool(request.toolType);
  };

  useEffect(() => {
    if (mode !== "move" || !temporary) return;
    const handlePointMoveKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleCancelMove();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pointOnCampus(temporary, campusBoundary)) handleSavePosition();
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement | null)?.tagName ?? "")) return;
      const directions = {
        ArrowUp: "north",
        ArrowDown: "south",
        ArrowLeft: "west",
        ArrowRight: "east",
      } as const;
      const direction = directions[event.key as keyof typeof directions];
      if (!direction) return;
      event.preventDefault();
      updateMovePosition(nudgePoint(temporary, direction, event.shiftKey ? 5 : 0.5));
    };
    window.addEventListener("keydown", handlePointMoveKey);
    return () => window.removeEventListener("keydown", handlePointMoveKey);
  }, [campusBoundary, mode, temporary]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mode === "move") return;
      if (pendingToolRequest) {
        setPendingToolRequest(null);
      } else if (workingSessionManager.hasActiveDraft()) {
        setPendingToolRequest({ toolType: "select" });
      } else if (activeTool !== "select") {
        activateTool("select");
      } else {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [activeTool, mode, pendingToolRequest, workingSessionManager]);

  const workingSessionState = workingSessionManager.getState();
  const recordPropertyOperation = (
    domain: SpatialDomain,
    entityId: string,
    before: object,
    after: object,
    description: string,
  ) => {
    workingSessionManager.executeOperation({
      type: "update_properties",
      domain,
      entityId,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      description,
    });
    setDirty(true);
  };

  const locationModalEntity: Location | null = selectedLocation ?? (selectedBuilding ? {
    id: selectedBuildingLocation?.id ?? selectedBuilding.id,
    name: selectedBuilding.name,
    code: selectedBuilding.code,
    type: "Building",
    parentId: null,
    function: selectedBuildingLocation?.function ?? "Campus Building",
    keywords: selectedBuildingLocation?.keywords ?? "",
    status: selectedBuildingLocation?.status ?? selectedBuilding.status ?? "Active",
    lat: selectedBuildingLocation?.lat ?? null,
    lng: selectedBuildingLocation?.lng ?? null,
    positioned: true,
  } : null);

  const startSelectedBuildingGeometryEdit = () => {
    if (!selectedBuilding) return;
    setEditingBuildingId(selectedBuilding.id);
    setBuildingName(selectedBuilding.name);
    setBuildingCode(selectedBuilding.code);
    setPoints([...selectedBuilding.points]);
    setPolygonInteraction("reshape");
    setPolygonClosed(true);
    setMode("area");
  };

  const startSelectedBuildingMove = () => {
    if (!selectedBuilding) return;
    setEditingBuildingId(selectedBuilding.id);
    setBuildingName(selectedBuilding.name);
    setBuildingCode(selectedBuilding.code);
    setPoints([...selectedBuilding.points]);
    setPolygonInteraction("move");
    setPolygonClosed(true);
    setMode("area");
  };

  const retireLocalFeature = (feature: LocalMapFeatureEntity) => {
    const featureLink = [...directoryMapLayers.featureLinks, ...localFeatureLinks]
      .find((link) => link.featureId === feature.id);
    const operation = buildRetireLocalFeatureOperation(feature, featureLink);
    const updated = {
      ...feature,
      status: "retired" as const,
      linkedBuildingId: featureLink ? null : feature.linkedBuildingId,
    };
    setLocalFeatureChanges((items) => [...items.filter((item) => item.id !== updated.id), updated]);
    if (featureLink) setUnlinkedFeatureLinkIds((ids) => [...new Set([...ids, featureLink.id])]);
    workingSessionManager.executeOperation(operation);
    setDirty(true);
  };

  const restoreLocalFeature = (feature: LocalMapFeatureEntity) => {
    const featureLink = [...directoryMapLayers.featureLinks, ...localFeatureLinks]
      .find((link) => link.featureId === feature.id);
    const operation = buildRestoreLocalFeatureOperation(feature, featureLink);
    const updated = {
      ...feature,
      status: "active" as const,
      linkedBuildingId: featureLink?.targetEntityId ?? feature.linkedBuildingId,
    };
    setLocalFeatureChanges((items) => [...items.filter((item) => item.id !== updated.id), updated]);
    if (featureLink) setUnlinkedFeatureLinkIds((ids) => ids.filter((id) => id !== featureLink.id));
    workingSessionManager.executeOperation(operation);
    setDirty(true);
  };

  const inspectorModel = (() => {
    if (!selected) return null;
    if (selectedBuilding) {
      return {
        id: selectedBuilding.id,
        kind: "building",
        title: selectedBuilding.name,
        domain: "Locations",
        status: !selectedBuildingHasFootprint
          ? "Building preserved · Footprint unlinked"
          : selectedBuildingRoutable
            ? "Linked & Routable"
            : "Linked · Entrance needed",
        summary: [
          { label: "Code", value: selectedBuilding.code },
          { label: "Geometry", value: `Building Footprint · ${selectedBuilding.points.length} vertices` },
          { label: "Entrances", value: String(selectedBuildingEntrances.length) },
        ],
        details: (
          <>
            <section aria-label="Building room directory" className="inspector-related-section">
              <h3>Room directory</h3>
              {(() => {
                const children = currentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name);
                const grouped = new Map<string, Location[]>();
                children.forEach((child) => {
                  const floor = child.floor || "Unspecified Floor";
                  grouped.set(floor, [...(grouped.get(floor) ?? []), child]);
                });
                return grouped.size ? [...grouped.entries()].map(([floor, rooms]) => (
                  <div key={floor} className="inspector-related-group">
                    <strong>{floor}</strong>
                    {rooms.map((room) => <span key={room.id}>{room.name} · {room.code}</span>)}
                  </div>
                )) : <p>No Indoor Locations recorded.</p>;
              })()}
            </section>
            <section aria-label="Building entrances" className="inspector-related-section">
              <h3>Entrance Route Nodes</h3>
              {selectedBuildingEntrances.length
                ? selectedBuildingEntrances.map((node) => <span key={node.id}>{node.name}</span>)
                : <p>No active Entrance Route Node.</p>}
            </section>
          </>
        ),
        primaryAction: {
          label: "▱ Reshape Footprint",
          onSelect: startSelectedBuildingGeometryEdit,
        },
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("location") },
          {
            label: "✥ Move Footprint",
            onSelect: startSelectedBuildingMove,
          },
          {
            label: "🗑 Retire Footprint",
            tone: "danger" as const,
            onSelect: () => {
              const footprint = currentLocalFeatures.find((feature) =>
                feature.family === "building_footprint"
                && feature.linkedBuildingId === selectedBuilding.id,
              );
              if (!footprint) return;
              retireLocalFeature(footprint);
              setSelected({ type: "local_feature", id: footprint.id });
            },
          },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedLocation) {
      return {
        id: selectedLocation.id,
        kind: "outdoor_location",
        title: selectedLocation.name,
        domain: "Locations",
        status: selectedLocation.positioned ? "Positioned Outdoor Point" : "Not positioned",
        summary: [
          { label: "Code", value: selectedLocation.code },
          { label: "Type", value: selectedLocation.type },
          { label: "Latitude", value: selectedLocation.lat?.toFixed(6) ?? "—" },
          { label: "Longitude", value: selectedLocation.lng?.toFixed(6) ?? "—" },
        ],
        primaryAction: { label: "✥ Move Marker", onSelect: handleStartMoveMarker },
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("location") },
          {
            label: "⎋ Remove Position",
            tone: "danger" as const,
            onSelect: () => {
              const updated = { ...selectedLocation, lat: null, lng: null, positioned: false };
              setLocalLocations((items) => [...items.filter((item) => item.id !== updated.id), updated]);
              workingSessionManager.executeOperation({
                type: "update_geometry",
                domain: "Locations",
                entityId: updated.id,
                before: selectedLocation as unknown as Record<string, unknown>,
                after: updated as unknown as Record<string, unknown>,
                description: `Remove position from ${selectedLocation.name}`,
              });
              setDirty(true);
            },
          },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedNode) {
      const connectedPathways = currentPathways.filter((pathway) => pathway.sourceNodeId === selectedNode.id || pathway.destinationNodeId === selectedNode.id);
      const connectedPaths = connectedPathways.length;
      return {
        id: selectedNode.id,
        kind: selectedNode.nodeType === "Entrance" ? "entrance_route_node" : "route_node",
        title: selectedNode.name,
        domain: "Routes & Paths",
        status: selectedNode.nodeType === "Entrance" ? "Entrance Route Node" : `${selectedNode.nodeType} Route Node`,
        summary: [
          { label: "Node Type", value: selectedNode.nodeType },
          { label: "Connected Pathways", value: String(connectedPaths) },
          { label: "Latitude", value: selectedNode.lat.toFixed(6) },
          { label: "Longitude", value: selectedNode.lng.toFixed(6) },
        ],
        primaryAction: { label: selectedNode.nodeType === "Entrance" ? "✥ Move Entrance" : "✥ Move Route Node", onSelect: handleStartMoveNode },
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("route") },
          ...(selectedNode.nodeType === "Entrance" ? [{
            label: "⎋ Convert to Standard Node",
            tone: "danger" as const,
            onSelect: () => {
              const updated = { ...selectedNode, nodeType: "Junction" as const, associatedPlaceId: null };
              updateNode(updated);
              recordPropertyOperation("Routes & Paths", selectedNode.id, selectedNode, updated, `Convert ${selectedNode.name} to a standard Route Node`);
            },
          }] : []),
          {
            label: "🗑 Deactivate Route Node",
            tone: "danger" as const,
            onSelect: () => {
              const updated = { ...selectedNode, status: "Inactive" as const };
              updateNode(updated);
              workingSessionManager.executeOperation({
                type: "retire_entity",
                domain: "Routes & Paths",
                entityId: selectedNode.id,
                before: selectedNode as unknown as Record<string, unknown>,
                after: updated as unknown as Record<string, unknown>,
                description: `Deactivate ${selectedNode.name}`,
              });
              const closedPathways = connectedPathways.map((pathway) => ({ ...pathway, status: "Closed" as const }));
              if (closedPathways.length > 0) {
                setLocalPathways((items) => [
                  ...items.filter((item) => !closedPathways.some((pathway) => pathway.id === item.id)),
                  ...closedPathways,
                ]);
                closedPathways.forEach((pathway) => {
                  const before = connectedPathways.find((candidate) => candidate.id === pathway.id)!;
                  workingSessionManager.executeOperation({
                    type: "update_properties",
                    domain: "Routes & Paths",
                    entityId: pathway.id,
                    before: before as unknown as Record<string, unknown>,
                    after: pathway as unknown as Record<string, unknown>,
                    description: `Close ${pathway.name} after deactivating ${selectedNode.name}`,
                  });
                });
              }
              setDirty(true);
            },
          },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedPath) {
      return {
        id: selectedPath.id,
        kind: "pathway",
        title: selectedPath.name || "Campus Pathway",
        domain: "Routes & Paths",
        status: `${selectedPath.direction} · ${selectedPath.status}`,
        summary: [
          { label: "Source", value: currentNodes.find((node) => node.id === selectedPath.sourceNodeId)?.name ?? selectedPath.sourceNodeId },
          { label: "Destination", value: currentNodes.find((node) => node.id === selectedPath.destinationNodeId)?.name ?? selectedPath.destinationNodeId },
          { label: "Distance", value: selectedPath.distance },
          { label: "Intermediate Path Points", value: String(selectedPath.pathPoints.length) },
        ],
        primaryAction: {
          label: "⌁ Reshape Pathway",
          onSelect: () => {
            setEditingPathId(selectedPath.id);
            setPathPoints(selectedPath.pathPoints);
            setMode("path");
          },
        },
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("route") },
          {
            label: "🗑 Close Pathway",
            tone: "danger" as const,
            onSelect: () => {
              const updated = { ...selectedPath, status: "Closed" as const };
              updatePathway(updated);
              recordPropertyOperation("Routes & Paths", selectedPath.id, selectedPath, updated, `Close ${selectedPath.name}`);
            },
          },
        ],
      } satisfies InspectorCardModel;
    }
    if (selected.type === "path_point" && editingPathId && selectedPathPointIndex !== null && pathPoints[selectedPathPointIndex]) {
      const point = pathPoints[selectedPathPointIndex];
      return {
        id: selected.id,
        kind: "path_point",
        title: `Path Point #${selectedPathPointIndex + 1}`,
        domain: "Routes & Paths",
        status: "Intermediate Pathway geometry",
        summary: [
          { label: "Parent Pathway", value: activePathway?.name ?? editingPathId },
          { label: "Latitude", value: point[0].toFixed(6) },
          { label: "Longitude", value: point[1].toFixed(6) },
        ],
        details: (
          <div className="inspector-point-inputs">
            <label>Latitude
              <input aria-label="Path Point latitude" type="number" step="any" value={point[0]} onChange={(event) => {
                setPathPoints((current) => current.map((item, index) => index === selectedPathPointIndex ? [Number(event.target.value), item[1]] : item));
                setPathDraftDirty(true);
              }} />
            </label>
            <label>Longitude
              <input aria-label="Path Point longitude" type="number" step="any" value={point[1]} onChange={(event) => {
                setPathPoints((current) => current.map((item, index) => index === selectedPathPointIndex ? [item[0], Number(event.target.value)] : item));
                setPathDraftDirty(true);
              }} />
            </label>
          </div>
        ),
        primaryAction: {
          label: manualPathPointDrag ? "Stop Dragging" : "✥ Drag Path Point",
          onSelect: () => setManualPathPointDrag((enabled) => !enabled),
        },
        overflowActions: [
          { label: "✓ Save Pathway", onSelect: handleSavePathShape },
          {
            label: "↩ Inspect Parent Pathway",
            onSelect: () => {
              setSelectedPathPointIndex(null);
              setSelected(activePathway ? { type: "pathway", id: activePathway.id } : null);
            },
          },
          {
            label: "🗑 Remove Path Point",
            tone: "danger" as const,
            onSelect: () => {
              setPathPoints((current) => current.filter((_, index) => index !== selectedPathPointIndex));
              setSelectedPathPointIndex(null);
              setSelected(activePathway ? { type: "pathway", id: activePathway.id } : null);
              setPathDraftDirty(true);
            },
          },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedLocalFeature) {
      const readOnly = !selectedLocalFeature.isEditable || selectedLocalFeature.family === "readonly_basemap";
      const retired = selectedLocalFeature.status === "retired";
      const disabledReason = "Imported basemap context cannot be edited in the Map Editor.";
      const family = EDITABLE_LOCAL_FEATURE_FAMILIES.find((candidate) => candidate.id === selectedLocalFeature.family);
      return {
        id: selectedLocalFeature.id,
        kind: "local_map_feature",
        title: selectedLocalFeature.name,
        domain: "Local Map Data",
        status: readOnly ? "Imported context feature" : retired ? "Retired in Working Session" : family?.label,
        readOnly,
        summary: [
          { label: "Feature Family", value: selectedLocalFeature.family.replaceAll("_", " ") },
          { label: "Geometry", value: selectedLocalFeature.geometryType },
          { label: "Area / Length", value: selectedLocalFeature.areaOrLength ?? "—" },
          { label: "Lifecycle", value: selectedLocalFeature.status ?? "active" },
        ],
        details: (
          <>
            {retired && (
              <div className="inspector-retired-warning" role="alert" aria-label="Retired Local Map Feature">
                ⚠ This feature is retired in this Working Session. It remains recoverable until save.
              </div>
            )}
            {localFeatureActionNotice && <p className="inspector-action-notice" role="status">{localFeatureActionNotice}</p>}
          </>
        ),
        primaryAction: {
          label: readOnly
            ? "▱ Reshape Boundary"
            : retired
              ? "⎌ Restore Feature"
              : `${family?.icon ?? "▱"} Reshape ${family?.label ?? "Feature"}`,
          disabled: readOnly,
          disabledReason: readOnly ? disabledReason : undefined,
          onSelect: retired
            ? () => restoreLocalFeature(selectedLocalFeature)
            : () => setLocalFeatureActionNotice(`${family?.label ?? "Local feature"} geometry is ready for reshaping.`),
        },
        overflowActions: retired ? [] : [
          {
            label: "✎ Edit Details",
            disabled: readOnly,
            disabledReason: readOnly ? disabledReason : undefined,
            onSelect: () => setOwnerModal("local_feature"),
          },
          {
            label: "🗑 Retire Feature",
            tone: "danger" as const,
            disabled: readOnly,
            disabledReason: readOnly ? disabledReason : undefined,
            onSelect: () => retireLocalFeature(selectedLocalFeature),
          },
        ],
        provenance: selectedLocalFeature.provenance,
      } satisfies InspectorCardModel;
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-100px)] min-h-[580px] p-2">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-5 py-3 rounded-[24px] border border-[#e1e3e4] shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#005931] text-white flex items-center justify-center font-bold text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-[#191c1d] leading-tight">Interactive Map Editor</h1>
            <p className="text-[11px] text-[#3f4941]">Plot locations, calibrate route nodes, and adjust pathway curve vertices</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {draftVersion !== null && (
            <span className="rounded-full bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-700">Draft v{draftVersion}</span>
          )}
          {publishedVersionId && (
            <span className="rounded-full bg-emerald-50 px-3 py-2 text-[11px] font-bold text-[#005931]">Published {publishedVersionId}</span>
          )}
          <span
            role="status"
            aria-label="Working Session changes"
            className="rounded-full bg-[#edf3ef] px-3 py-2 text-[11px] font-bold text-[#365047]"
          >
            {workingSessionState.uncommittedCount} {workingSessionState.uncommittedCount === 1 ? "change" : "changes"}
          </span>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="px-4 py-2 border border-[#005931] rounded-full text-xs font-bold text-[#005931] hover:bg-emerald-50 transition cursor-pointer"
          >
            Preview Map
          </button>
          <button
            type="button"
            disabled={lifecycleBusy || draftVersion === null}
            onClick={() => setConfirm("discard")}
            className="px-4 py-2 border border-[#dbe0e2] rounded-full text-xs font-bold text-[#3f4941] hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
          >
            Discard Draft
          </button>
          <button
            type="button"
            disabled={lifecycleBusy || draftVersion === null || workingSessionState.isDirty}
            onClick={() => setConfirm("publish")}
            className="px-4 py-2 border border-[#005931] rounded-full text-xs font-bold text-[#005931] hover:bg-emerald-50 disabled:opacity-40 transition cursor-pointer"
          >
            Publish Map
          </button>
          <button
            type="button"
            disabled={!workingSessionState.isDirty || lifecycleBusy || draftVersion === null}
            onClick={openSaveReview}
            className="px-5 py-2 bg-[#005931] hover:bg-[#004727] rounded-full text-xs font-bold text-white shadow disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Save Draft</span>
          </button>
        </div>
      </div>

      <div className="relative flex-1 rounded-[28px] overflow-hidden border border-[#e1e3e4] shadow-sm bg-[#dce8e2] min-h-[500px]">
        <MapContainer
          center={campusCenter}
          zoom={18}
          minZoom={15}
          maxBounds={navigationBounds}
          maxBoundsViscosity={0.7}
          zoomControl={false}
          className="w-full h-full"
        >
          <TileLayer
            attribution={
              basemap === "satellite"
                ? `© Esri${displaysOsmOverlays ? " · © OpenStreetMap contributors" : ""}`
                : "© OpenStreetMap contributors"
            }
            url={
              basemap === "satellite"
                ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
          />
          <MapController
            onMapClick={onMapClick}
            flyTarget={flyTarget}
            navigationBounds={navigationBounds}
            onViewportChange={handleViewportChange}
          />

          {canvasLocalFeatures.map((feature) => {
            const coordinates = feature.coordinates as [number, number][];
            const isSelected = selected?.type === "local_feature" && selected.id === feature.id;
            const pathOptions = getLocalFeaturePathOptions(feature, isSelected);
            const tooltip = (
              <Tooltip sticky direction="top" className="map-label">
                <div className="font-bold text-xs">{feature.name}</div>
                <div className="text-[10px] text-gray-500 font-normal">
                  {feature.family === "readonly_basemap" ? "🔒 Read-Only Basemap" : feature.family.replaceAll("_", " ")}
                </div>
              </Tooltip>
            );
            return feature.geometryType === "line" ? (
              <Polyline
                key={feature.id}
                positions={coordinates}
                pathOptions={pathOptions}
                eventHandlers={{ click: () => selectObject("local_feature", feature.id) }}
              >
                {tooltip}
              </Polyline>
            ) : (
              <Polygon
                key={feature.id}
                positions={coordinates}
                pathOptions={pathOptions}
                eventHandlers={{ click: () => selectObject("local_feature", feature.id) }}
              >
                {tooltip}
              </Polygon>
            );
          })}

          {mode === "local_feature" && localFeaturePoints.length >= 2 && (() => {
            const previewFeature: LocalMapFeatureEntity = {
              id: "draft",
              family: selectedLocalFeatureFamily,
              name: localFeatureName,
              isEditable: true,
              geometryType: selectedLocalFeatureDefinition.geometryType,
              coordinates: localFeaturePoints,
              status: "active",
            };
            const pathOptions = {
              ...getLocalFeaturePathOptions(previewFeature, true),
              className: "local-feature-draft",
              dashArray: "6 5",
            };
            return selectedLocalFeatureDefinition.geometryType === "line"
              ? <Polyline positions={localFeaturePoints} pathOptions={pathOptions} />
              : <Polygon positions={localFeaturePoints} pathOptions={pathOptions} />;
          })()}

          {filteredBuildings.map((building) => {
            const isSelected = selected?.id === building.id;
            const footprint = currentLocalFeatures.find((feature) =>
              feature.family === "building_footprint"
              && (feature.linkedBuildingId === building.id || feature.id === `feat-poly-${building.id}`),
            );
            const footprintRetired = footprint?.status === "retired";
            const buildingFillOpacity =
              footprintRetired ? 0.1 : mode === "path" ? 0.08 : isSelected ? 0.35 : 0.22;

            return (
              <Fragment key={building.id}>
              <Polygon
                key={building.id}
                positions={building.points}
                pathOptions={{
                  color: footprintRetired
                    ? "#7c8780"
                    : !geometryOnCampus(building.points, campusBoundary)
                    ? "#b42318"
                    : isSelected
                      ? "#e67e22"
                      : "#278b70",
                  fillColor: footprintRetired ? "#cbd2ce" : isSelected ? "#f97316" : "#8fd1bd",
                  fillOpacity: buildingFillOpacity,
                  weight: isSelected ? 3 : 2,
                  opacity: footprintRetired ? 0.48 : 1,
                  dashArray: footprintRetired ? "7 6" : undefined,
                }}
                eventHandlers={{
                  click: () => {
                    if (footprintRetired && footprint) selectObject("local_feature", footprint.id);
                    else selectObject("building", building.id);
                  },
                }}
              >
                <Tooltip sticky direction="top" className="map-label">
                  <div className="font-bold text-xs">{building.name}</div>
                  {building.code && <div className="text-[10px] text-gray-500 font-normal">{building.code}</div>}
                  {!geometryOnCampus(building.points, campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                  {footprintRetired && <div className="text-[10px] font-semibold text-amber-700">Retired · restore available</div>}
                </Tooltip>
              </Polygon>
              {localBuildings.some((draft) => draft.id === building.id) && mode === "select" && editingBuildingId === null && (
                <Marker
                  position={polygonCentroid(building.points)}
                  icon={createLocationPinIcon(isSelected)}
                  eventHandlers={{ click: () => selectObject("building", building.id) }}
                />
              )}
              </Fragment>
            );
          })}

          {filteredPathways.map((path) => {
            const source = currentNodes.find((node) => node.id === path.sourceNodeId);
            const destination = currentNodes.find((node) => node.id === path.destinationNodeId);
            const isEditingThisPath = editingPathId === path.id && mode === "path";
            const currentPoints = isEditingThisPath ? pathPoints : path.pathPoints;
            const isSelected = selected?.id === path.id || isEditingThisPath;

            const pathOpacity =
              mode === "place" || mode === "area"
                ? 0.25
                : isSelected
                  ? 0.95
                  : 0.8;

            return source && destination ? (
              <Polyline
                key={path.id}
                positions={[
                  [source.lat, source.lng],
                  ...currentPoints,
                  [destination.lat, destination.lng],
                ]}
                pathOptions={{
                  color: !geometryOnCampus([
                    ...(source ? [[source.lat, source.lng] as [number, number]] : []),
                    ...currentPoints,
                    ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
                  ], campusBoundary) ? "#b42318" : isSelected ? "#e67e22" : "#005931",
                  weight: isSelected ? 6 : mode === "path" ? 5 : 4,
                  dashArray: isSelected ? undefined : "7 6",
                  opacity: pathOpacity,
                }}
                eventHandlers={{
                  click: () => {
                    selectObject("pathway", path.id);
                  },
                }}
              >
                <Tooltip sticky direction="top" className="map-label">
                  <div className="font-bold text-xs">{path.name || "Campus Pathway"}</div>
                  <div className="text-[10px] text-gray-500 font-normal">Shade: {path.shade} · {path.direction}</div>
                  {!geometryOnCampus([
                    ...(source ? [[source.lat, source.lng] as [number, number]] : []),
                    ...currentPoints,
                    ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
                  ], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>
              </Polyline>
            ) : null;
          })}

          {filteredLocations.map((loc) => {
            if (mode === "move" && movingType === "location" && movingId === loc.id) return null;
            const isSelected = selected?.type === "location" && selected?.id === loc.id;
            return (
              <Marker
                key={loc.id}
                position={[loc.lat, loc.lng]}
                icon={createLocationPinIcon(isSelected)}
                eventHandlers={{
                  click: () => {
                    selectObject("location", loc.id);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -28]} className="map-label">
                  <div className="font-bold text-xs">{loc.name}</div>
                  <div className="text-[10px] text-gray-500 font-normal">{loc.type} · {loc.code}</div>
                  {!pointOnCampus([loc.lat, loc.lng], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>
                <Popup>
                  <strong>{loc.name}</strong>
                  <br />
                  <small>{loc.type} · {loc.code}</small>
                </Popup>
              </Marker>
            );
          })}

          {filteredNodes.map((node) => {
            if (mode === "move" && movingType === "node" && movingId === node.id) return null;
            const isSelected = selected?.type === "node" && selected?.id === node.id;
            return (
              <Marker
                key={node.id}
                position={[node.lat, node.lng]}
                icon={createNodeIcon(isSelected)}
                eventHandlers={{
                  click: () => {
                    if (mode === "path" && !editingPathId) {
                      if (node.status !== undefined && node.status !== "Active") {
                        setError("Pathways can only use active Route Nodes.");
                        return;
                      }
                      if (!pathStartNodeId) {
                        setPathStartNodeId(node.id);
                        setPathDraftDirty(true);
                        setSelected({ type: "node", id: node.id });
                        return;
                      }
                      const connectionError = pathwayConnectionError(pathStartNodeId, node.id, currentPathways);
                      if (connectionError) {
                        setError(connectionError);
                        return;
                      }
                      const source = currentNodes.find((candidate) => candidate.id === pathStartNodeId);
                      if (!source) return;
                      const newPath: Pathway = {
                        id: `pathway-${Date.now()}`,
                        name: "New Campus Pathway",
                        sourceNodeId: source.id,
                        destinationNodeId: node.id,
                        distance: "Unknown",
                        time: "Unknown",
                        shade: "Unknown",
                        type: "Campus walkway",
                        direction: "Two-way",
                        status: "Open",
                        pathPoints: [],
                      };
                      setLocalPathways((current) => [...current, newPath]);
                      setEditingPathId(newPath.id);
                      setProvisionalPathwayId(newPath.id);
                      setPathPoints([]);
                      setSelected({ type: "pathway", id: newPath.id });
                      setPathDraftDirty(true);
                      setError("");
                      return;
                    }
                    selectObject("node", node.id);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} className="map-label">
                  <div className="font-bold text-xs">{node.name}</div>
                  <div className="text-[10px] text-gray-500 font-normal">Route Node ({node.nodeType})</div>
                  {!pointOnCampus([node.lat, node.lng], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>
              </Marker>
            );
          })}

          {mode === "path" &&
            pathPoints.map((point, index) => (
              <Marker
                key={`path-point-${index}`}
                position={point}
                icon={createPointIcon(true)}
                draggable={manualPathPointDrag && selectedPathPointIndex === index}
                eventHandlers={{
                  click: () => {
                    setSelectedPathPointIndex(index);
                    setSelected({ type: "path_point", id: `${editingPathId ?? "pathway"}:point:${index}` });
                  },
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    const next = marker.getLatLng();
                    if (!pointOnCampus([next.lat, next.lng], campusBoundary)) {
                      setError("The path point must stay inside the ISU Echague campus boundary.");
                      return;
                    }
                    setError("");
                    setPathPoints((current) =>
                      current.map((item, i) =>
                        i === index ? [next.lat, next.lng] : item,
                      ),
                    );
                    setSelectedPathPointIndex(index);
                    setPathDraftDirty(true);
                  },
                }}
              />
            ))}

          {mode === "path" && activePathway && (() => {
            const source = currentNodes.find((node) => node.id === activePathway.sourceNodeId);
            const destination = currentNodes.find((node) => node.id === activePathway.destinationNodeId);
            if (!source || !destination) return null;
            const coordinates: [number, number][] = [[source.lat, source.lng], ...pathPoints, [destination.lat, destination.lng]];
            const midpoints = segmentMidpoints(coordinates.map(([latitude, longitude]) => ({ latitude, longitude })));
            return midpoints.map((midpoint, segmentIndex) => {
              return (
                <Marker
                  key={`path-split-handle-${segmentIndex}`}
                  position={[midpoint.latitude, midpoint.longitude]}
                  icon={createPathPointSplitHandleIcon()}
                  eventHandlers={{ click: () => insertPathPoint(segmentIndex) }}
                >
                  <Tooltip permanent direction="center">+</Tooltip>
                </Marker>
              );
            });
          })()}

          {points.length > 1 && (
            <Polygon
              positions={points}
              pathOptions={{
                color: polygonInvalid ? "#b42318" : "#005931",
                fillColor: "#8fd1bd",
                fillOpacity: 0.25,
                weight: 2,
              }}
            />
          )}

          {mode === "area" &&
            points.map((pt, i) => (
              <Marker
                key={`area-pt-${i}`}
                position={pt}
                icon={createVertexIcon(i)}
                draggable={polygonInteraction === "reshape"}
                eventHandlers={{
                  click: () => {
                    if (i === 0 && polygonInteraction === "draw" && !polygonClosed && points.length >= 3) closePolygon();
                  },
                  drag: (event) => {
                    const next = (event.target as L.Marker).getLatLng();
                    updatePolygonVertex(i, [next.lat, next.lng]);
                  },
                  dragend: (event) => {
                    const next = (event.target as L.Marker).getLatLng();
                    if (pointOnCampus([next.lat, next.lng], campusBoundary)) {
                      updatePolygonVertex(i, [next.lat, next.lng]);
                      setError("");
                    } else {
                      setError("The building footprint must stay inside the ISU Echague campus boundary.");
                    }
                  },
                }}
              />
            ))}

          {mode === "area" && polygonInteraction === "reshape" && points.length >= 3 && points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            return (
              <Marker
                key={`split-${index}`}
                position={[(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]}
                icon={createSplitIcon()}
                eventHandlers={{ click: () => insertPolygonVertex(index) }}
              />
            );
          })}

          {mode === "area" && polygonInteraction === "move" && points.length >= 3 && (
            <Marker
              position={polygonFeatureAnchor(points)}
              icon={createLocationPinIcon(true)}
              draggable
              eventHandlers={{
                drag: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  movePolygon([next.lat, next.lng]);
                },
                dragend: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  movePolygon([next.lat, next.lng]);
                },
              }}
            />
          )}

          {mode === "move" && moveOrigin && temporary && (
            <PointMoveLayer
              origin={moveOrigin}
              position={temporary}
              snapTargets={pointSnapTargets}
              campusBoundary={campusBoundary}
              outsideBoundary={movingOutsideBoundary}
              distanceMeters={moveDistanceMeters}
              snapped={pointIsSnapped}
              onPositionChange={updateMovePosition}
              onDropRejected={handleRejectedPointDrop}
              onDraggingChange={setIsPointDragging}
            />
          )}

          {temporary && mode !== "move" && (
            <Marker position={temporary} icon={createTempIcon()} />
          )}
        </MapContainer>

        {outsideBoundaryCount > 0 && (
          <div className="absolute bottom-4 right-4 z-[900] max-w-xs rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-xs text-amber-900 shadow-lg" role="status">
            <strong>{outsideBoundaryCount} existing map object{outsideBoundaryCount === 1 ? "" : "s"} outside campus boundary.</strong>
            <div className="mt-1">Legacy data is retained. Move or edit it back inside the boundary before saving changes.</div>
          </div>
        )}
        {pathwayCrossings[0] && (
          <div className="absolute bottom-4 left-4 z-[901] max-w-sm rounded-2xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 shadow-lg" role="alert" aria-label="Non-routable pathway crossing">
            <strong className="block">Pathways cross without a Junction</strong>
            <p className="mt-1">This visual crossing is not routable until a shared Junction Route Node is created.</p>
            <button type="button" onClick={createJunctionAtCrossing} className="mt-2 rounded-full bg-[#005931] px-3 py-2 font-bold text-white">
              Create Junction &amp; Split Pathway
            </button>
          </div>
        )}
        {nonRoutableBuildingId && mode === "select" && (
          <div className="absolute bottom-4 left-4 z-[900] max-w-sm rounded-2xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 shadow-lg" role="alert" aria-label="Building is not routable">
            <strong className="block">Building is not routable</strong>
            <p className="mt-1">This Building has 0 active Entrance Route Nodes.</p>
            <button type="button" onClick={startGuidedEntranceDraft} className="mt-2 rounded-full bg-[#005931] px-3 py-2 font-bold text-white">
              🚪 Add Entrance Route Node Now
            </button>
          </div>
        )}

        <div className="absolute top-4 left-4 z-[900] bg-white/95 backdrop-blur-md p-1.5 rounded-full shadow-lg border border-[#e1e3e4] flex items-center gap-1">
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "street" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => setBasemap("street")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span>Map</span>
          </button>
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "satellite" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => setBasemap("satellite")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Satellite</span>
          </button>
        </div>

        <ToolRailDock
          activeTool={activeTool}
          onSelectTool={selectTool}
          suspendedDrafts={workingSessionState.suspendedDrafts}
          onResumeDraft={requestDraftResume}
          showGuidance={mode !== "move"}
        />

        {mode === "local_feature" && (
          <LocalFeatureFamilyPalette
            selectedFamily={selectedLocalFeatureFamily}
            onSelectFamily={selectLocalFeatureFamily}
            featureName={localFeatureName}
            onFeatureNameChange={setLocalFeatureName}
            pointCount={localFeaturePoints.length}
            canCreate={canCreateLocalFeature}
            onCreate={createSelectedLocalFeature}
            onClear={() => setLocalFeaturePoints([])}
          />
        )}

        {pendingToolRequest && workingSessionState.activeDraft && (
          <ToolInterruptionDialog
            currentTool={workingSessionState.activeDraft.toolType}
            requestedTool={pendingToolRequest.toolType}
            onSuspend={() => finishInterruption("keep_draft")}
            onContinue={() => setPendingToolRequest(null)}
            onDiscard={() => finishInterruption("discard_geometry")}
          />
        )}

        <div className="absolute top-4 right-4 z-[900] w-72 bg-white/95 backdrop-blur-md p-2 rounded-[20px] shadow-lg border border-[#e1e3e4]">
          <div className="relative flex items-center">
            <svg className="w-4 h-4 absolute left-3 text-[#3f4941]/60 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campus places..."
              className="w-full bg-[#f8f9fa] text-xs font-semibold py-2 pl-9 pr-7 rounded-xl outline-none focus:ring-2 focus:ring-[#005931]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 text-xs font-bold text-[#005931]"
              >
                ×
              </button>
            )}
          </div>
          {results.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#e1e3e4] max-h-56 overflow-y-auto text-xs">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left p-2 hover:bg-[#f8f9fa] rounded-lg flex items-center justify-between transition"
                  onClick={() => handleSearchResultClick(item)}
                >
                  <span className="font-semibold text-[#191c1d]">{item.name}</span>
                  <span className="text-[10px] text-[#3f4941] bg-[#e1e3e4] px-2 py-0.5 rounded-full">{item.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === "move" && temporary && (
          <section
            className={`point-move-hud${movingOutsideBoundary ? " outside-boundary" : ""}`}
            role="region"
            aria-label={`Move ${movingObjectName}`}
          >
            <div className="point-move-hud-header">
              <div>
                <span>Move {movingType === "location" ? "Outdoor Point Location" : "Route Node"}</span>
                <strong>{movingObjectName}</strong>
              </div>
              <div className="point-move-distance" aria-live="polite">
                Δ {moveDistanceMeters.toFixed(1)}m {pointIsSnapped && <em>(Snapped)</em>}
              </div>
            </div>
            <PointCoordinateInputs position={temporary} onChange={updateMovePosition} />
            {movingOutsideBoundary && (
              <div className="point-move-warning" role="alert">
                Position is outside the ISU Echague Campus Boundary. Drop and save are blocked.
              </div>
            )}
            {moveDropRejected && (
              <div className="point-move-warning" role="alert">
                Point drop was blocked outside the ISU Echague Campus Boundary. The marker returned to its last valid position.
              </div>
            )}
            <div className="point-move-hud-footer">
              <span>{isPointDragging ? "Dragging · release to preview" : "Arrow keys 0.5m · Shift + Arrow 5.0m · Enter save · Esc cancel"}</span>
              <div>
                <button type="button" onClick={handleCancelMove}>Cancel</button>
                <button type="button" className="primary" disabled={movingOutsideBoundary} onClick={handleSavePosition}>Save Position</button>
              </div>
            </div>
          </section>
        )}

        {mode !== "select" && mode !== "move" && selected?.type !== "path_point" && (
          <aside className="absolute top-20 right-4 z-[901] w-80 max-h-[calc(100%-100px)] overflow-y-auto bg-white/98 backdrop-blur-md p-5 rounded-[28px] shadow-2xl border border-[#e1e3e4]">
            {error && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
                {error}
              </div>
            )}

            {mode === "area" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Building Footprint</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">{polygonClosed ? "Create or Attach Building" : "Draw Building / Location Footprint"}</h2>
                {polygonClosed ? (
                  <section aria-label="Create or attach building record" className="mt-3">
                    <p className="text-xs text-[#3f4941]">The footprint is complete. Choose the Building record it should represent.</p>
                    <div role="tablist" aria-label="Building record workflow" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#edf3ef] p-1">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={buildingRecordMode === "create"}
                        onClick={() => setBuildingRecordMode("create")}
                        className={`rounded-lg px-2 py-2 text-xs font-bold ${buildingRecordMode === "create" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        ★ Create New Record
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={buildingRecordMode === "attach"}
                        onClick={() => setBuildingRecordMode("attach")}
                        className={`rounded-lg px-2 py-2 text-xs font-bold ${buildingRecordMode === "attach" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        🔗 Attach Existing Record
                      </button>
                    </div>
                    {buildingRecordMode === "attach" && (
                      <div className="mt-3 space-y-2">
                        <input
                          type="search"
                          aria-label="Search existing Buildings"
                          value={buildingRecordSearch}
                          onChange={(event) => setBuildingRecordSearch(event.target.value)}
                          placeholder="Search by name or code"
                          className="w-full rounded-lg border border-[#dbe0e2] px-2 py-2 text-sm"
                        />
                        <div className="space-y-2">
                          {buildingRecordCandidates.map((building) => {
                            const eligibility = buildingAttachmentEligibility(building);
                            return (
                              <button
                                key={building.id}
                                type="button"
                                disabled={!eligibility.eligible}
                                aria-pressed={selectedBuildingRecordId === building.id}
                                onClick={() => setSelectedBuildingRecordId(building.id)}
                                className="w-full rounded-xl border border-[#dbe0e2] p-2 text-left text-xs disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                              >
                                <span className="block font-bold">{building.name} · {building.code}</span>
                                {eligibility.reason && <span className="mt-1 block text-red-700">{eligibility.reason}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                ) : (
                  <p className="text-xs text-[#3f4941] mt-1">
                    Click on the map to plot the perimeter corners of the building or area footprint. A minimum of 3 points is required to form a closed polygon.
                  </p>
                )}
                {(!polygonClosed || buildingRecordMode === "create") && (
                  <>
                    <label className="mt-3 block text-xs font-semibold text-[#3f4941]">Building name
                      <input aria-label="Building name" value={buildingName} onChange={(event) => setBuildingName(event.target.value)} placeholder="e.g. Science Annex" className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
                    </label>
                    <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Building code
                      <input aria-label="Building code" value={buildingCode} onChange={(event) => setBuildingCode(event.target.value)} placeholder="e.g. SCI-ANNEX" className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
                    </label>
                  </>
                )}
                <div className="text-xs font-bold text-[#191c1d] my-3">Points plotted: {points.length}</div>
                {polygonInvalid && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700" role="alert">
                    Self-intersecting footprint. Untangle the red edges before confirming the shape.
                  </div>
                )}
                {points.length > 0 && polygonInteraction === "reshape" && (
                  <div className="mb-3 space-y-1">
                    {points.map((point, index) => (
                      <div key={`${point.join(",")}-${index}`} className="flex items-center justify-between rounded-lg bg-[#f8f9fa] px-2 py-1 text-xs">
                        <span>V{index + 1} · {point[0].toFixed(5)}, {point[1].toFixed(5)}</span>
                        <button type="button" disabled={points.length <= 3} onClick={() => deletePolygonVertex(index)} className="text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    disabled={!points.length}
                    onClick={() => setPoints((c) => c.slice(0, -1))}
                    className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                  >
                    Remove Last Point
                  </button>
                  <button
                    type="button"
                    disabled={!points.length}
                    onClick={() => setPoints([])}
                    className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                  >
                    Clear Area
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
                  <button
                    type="button"
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                    onClick={() => selectTool("select")}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={polygonClosed && buildingRecordMode === "attach" ? !selectedBuildingRecordId : !canSaveBuilding}
                    onClick={polygonClosed
                      ? buildingRecordMode === "create" ? handleCreateBuildingRecord : handleAttachBuildingRecord
                      : handleSaveBuilding}
                    className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    {polygonClosed
                      ? buildingRecordMode === "create" ? "Create New Building" : "Attach Selected Building"
                      : polygonInteraction === "reshape" ? "✓ Confirm Shape" : "Save Building"}
                  </button>
                </div>
              </div>
            ) : mode === "place" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Place on Map</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">
                  {placingObjectType === "location" ? "Place Location Marker" : "Place Route Node"}
                </h2>
                <div className="flex flex-col gap-1.5 my-3">
                  <label className="text-xs font-semibold text-[#3f4941]">Object Type</label>
                  <select
                    value={placingObjectType === "location" ? "Location Marker" : "Route Node"}
                    onChange={(e) => {
                      const val = e.target.value === "Route Node" ? "node" : "location";
                      setPlacingObjectType(val);
                      setTemporary(null);
                      setPointDraftDirty(false);
                    }}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  >
                    <option>Location Marker</option>
                    <option>Route Node</option>
                  </select>
                </div>

                {placingObjectType === "location" ? (
                  <>
                    <div className="flex flex-col gap-1.5 my-3">
                      <label className="text-xs font-semibold text-[#3f4941]">Select Existing Record</label>
                      <select
                        value={placingId}
                        onChange={(e) => setPlacingId(e.target.value)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        <option value="__new__">＋ Add New Location Record (Click Map)</option>
                        {directoryLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="my-2 text-xs text-[#3f4941]">
                      {temporary
                        ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                        : "Click the map to preview a new position."}
                    </div>
                    {temporary && (
                      <div className="text-xs text-[#3f4941]">Latitude {temporary[0].toFixed(6)} · Longitude {temporary[1].toFixed(6)}</div>
                    )}
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => selectTool("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!temporary}
                        onClick={handleSavePlacedMarker}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                      >
                        Save Position
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Node Type</label>
                      <select
                        value={placingNodeType}
                        onChange={(e) => setPlacingNodeType(e.target.value as "Entrance" | "Junction" | "Access Point")}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        <option>Entrance</option>
                        <option>Junction</option>
                        <option>Access Point</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Node Name</label>
                      <input
                        type="text"
                        placeholder="e.g. CAS Entrance"
                        value={placingNodeName}
                        onChange={(e) => setPlacingNodeName(e.target.value)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Associated Place</label>
                      {placingAssociatedPlaceId && placingAssociatedPlaceId === nonRoutableBuildingId && (
                        <p className="text-xs font-bold text-[#005931]">
                          Associated Building: {currentBuildings.find((building) => building.id === placingAssociatedPlaceId)?.name ?? placingAssociatedPlaceId}
                        </p>
                      )}
                      <select
                        value={placingAssociatedPlaceId ?? ""}
                        onChange={(e) => setPlacingAssociatedPlaceId(e.target.value || null)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        <option value="">None</option>
                        {currentBuildings.map((b) => {
                          const location = currentLocations.find((item) => item.type === "Building" && (item.id === b.id || item.name === b.name));
                          return <option key={b.id} value={location?.id ?? b.id}>
                            {b.name} (Building)
                          </option>
                        })}
                      </select>
                    </div>
                    <div className="my-2 text-xs text-[#3f4941]">
                      {temporary
                        ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                        : "Click the map to position this route node."}
                    </div>
                    <label className="block text-xs font-semibold text-[#3f4941]">Latitude
                      <input aria-label="Placement latitude" type="number" step="any" value={temporary?.[0] ?? ""} onChange={(e) => { setTemporary([Number(e.target.value), temporary?.[1] ?? campusCenter[1]]); setPointDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                    </label>
                    <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
                      <input aria-label="Placement longitude" type="number" step="any" value={temporary?.[1] ?? ""} onChange={(e) => { setTemporary([temporary?.[0] ?? campusCenter[0], Number(e.target.value)]); setPointDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                    </label>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => selectTool("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!temporary || !placingNodeName.trim()}
                        onClick={handleSavePlacedNode}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                      >
                        Save Node
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : mode === "path" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Path Shape Points</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Calibrate Path Points</h2>
                <button type="button" className="mt-3 px-3 py-1.5 bg-[#005931] text-white rounded-full text-xs font-bold" onClick={startNewPathway}>＋ New Pathway</button>
                {!activePathway && (
                  <div className="mt-3 rounded-xl border border-[#dbe0e2] bg-[#f8f9fa] p-3 text-xs text-[#3f4941]">
                    <p>Select two existing active Route Nodes on the map to create a new Pathway. The endpoints are kept as nodes; only intermediate clicks become Path Points.</p>
                    <p className="mt-2 font-semibold">{pathStartNodeId ? `Start selected: ${currentNodes.find((node) => node.id === pathStartNodeId)?.name ?? "Route Node"}. Select a different node.` : "Select the first Route Node to begin."}</p>
                  </div>
                )}
                {activePathway && (
                  <>
                    <div className="flex flex-col gap-1.5 my-3">
                      <label className="text-xs font-semibold text-[#3f4941]">Pathway</label>
                      <select
                        value={editingPathId ?? ""}
                        onChange={(e) => {
                          setEditingPathId(e.target.value);
                          const found = directoryPathways.find((p) => p.id === e.target.value) || localPathways.find((p) => p.id === e.target.value);
                        if (found) setPathPoints(found.pathPoints || []);
                        setSelectedPathPointIndex(null);
                        }}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        {currentPathways.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-[#3f4941] my-2">
                        {manualPathPointDrag ? "Drag the selected Path Point to move it." : "Click the map to add path points or select a Path Point to adjust it."}{" "}
                      <strong>{pathPoints.length} points plotted</strong>.
                    </p>
                    <section aria-label="Pathway split handles" className="my-3 rounded-xl border border-[#dbe0e2] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#005931]">Midpoint split handles</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Array.from({ length: pathPoints.length + 1 }, (_, segmentIndex) => (
                          <button
                            key={segmentIndex}
                            type="button"
                            aria-label={`Add Path Point on segment ${segmentIndex + 1}`}
                            onClick={() => insertPathPoint(segmentIndex)}
                            className="h-7 w-7 rounded-full border border-[#005931] bg-white text-sm font-black text-[#005931]"
                          >+</button>
                        ))}
                      </div>
                    </section>
                    {selectedPathPointIndex !== null && pathPoints[selectedPathPointIndex] && (
                      <section aria-label="Selected Path Point" className="my-3 rounded-xl border border-[#dbe0e2] p-3">
                        <label className="block text-xs font-semibold text-[#3f4941]">Latitude
                          <input aria-label="Path Point latitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][0]} onChange={(event) => { setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [Number(event.target.value), point[1]] : point)); setPathDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                        </label>
                        <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
                          <input aria-label="Path Point longitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][1]} onChange={(event) => { setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [point[0], Number(event.target.value)] : point)); setPathDraftDirty(true); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                        </label>
                      </section>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button type="button" aria-pressed={manualPathPointDrag} onClick={() => setManualPathPointDrag((enabled) => !enabled)} className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4]">
                        {manualPathPointDrag ? "Stop Dragging" : "Drag Path Point"}
                      </button>
                      <button
                        type="button"
                        disabled={!pathPoints.length}
                        onClick={() => { setPathPoints((current) => selectedPathPointIndex === null
                          ? current.slice(0, -1)
                          : current.filter((_, index) => index !== selectedPathPointIndex)); setPathDraftDirty(true); }}
                        className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                      >
                        {selectedPathPointIndex === null ? "Remove Last Point" : "Remove Selected Point"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => selectTool("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePathShape}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                      >
                        Save Path
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selectedBuilding ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Building</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Building name
                  <input aria-label="Building name" value={selectedBuilding.name} onChange={(event) => updateBuilding({ ...selectedBuilding, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="mt-2 block text-[10px] font-bold text-[#3f4941]">Building code
                  <input aria-label="Building code" value={selectedBuilding.code} onChange={(event) => updateBuilding({ ...selectedBuilding, code: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <div className="text-xs text-[#3f4941] mt-2">Building footprint</div>
                <button type="button" className="mt-2 px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold" onClick={() => {
                  setEditingBuildingId(selectedBuilding.id);
                  setBuildingName(selectedBuilding.name);
                  setBuildingCode(selectedBuilding.code);
                  setPoints([...selectedBuilding.points]);
                  setMode("area");
                }}>Edit Footprint</button>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Object Type</dt>
                    <dd className="text-[#191c1d] font-bold">Building Area Footprint</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Routability</dt>
                    <dd className={`font-bold ${selectedBuildingRoutable ? "text-[#005931]" : "text-amber-700"}`}>
                      {selectedBuildingRoutable ? "Routable" : "Not routable"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Code</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedBuilding.code}</dd>
                  </div>
                </dl>
                <section aria-label="Building room directory" className="mt-4 rounded-xl border border-[#dbe0e2] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-extrabold text-[#191c1d]">Room directory</h3>
                    <button type="button" className="px-2.5 py-1.5 bg-[#005931] text-white rounded-full text-[10px] font-bold" onClick={() => {
                      setTemporary(null);
                      setNewLocation({ name: "", code: "", type: "Room", status: "Active", parentId: selectedBuilding.id, building: selectedBuilding.name, floor: "" });
                      setAddLocationOpen(true);
                    }}>＋ Add Room</button>
                  </div>
                  {(() => {
                    const children = currentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name);
                    const grouped = new Map<string, Location[]>();
                    children.forEach((child) => { const key = child.floor || "Unassigned floor"; grouped.set(key, [...(grouped.get(key) ?? []), child]); });
                    return grouped.size ? [...grouped.entries()].map(([floor, rooms]) => <div key={floor} className="mt-3"><div className="text-[10px] font-bold uppercase tracking-wide text-[#005931]">{floor}</div>{rooms.map((room) => <div key={room.id} className="flex justify-between gap-2 py-1 text-xs"><span className="font-semibold">{room.name}</span><span className="text-[#6b7280]">{room.code}</span></div>)}</div>) : <p className="mt-2 text-xs text-[#6b7280]">No rooms yet.</p>;
                  })()}
                </section>
                <section aria-label="Building entrances" className="mt-3 rounded-xl border border-[#dbe0e2] p-3">
                  <div className="flex items-center justify-between"><h3 className="text-xs font-extrabold text-[#191c1d]">Entrance nodes</h3><button type="button" className="text-[10px] font-bold text-[#005931]" onClick={() => { setPlacingObjectType("node"); setPlacingNodeType("Entrance"); setPlacingAssociatedPlaceId(selectedBuildingAssociationId ?? null); setMode("place"); }}>＋ Place Entrance</button></div>
                  {selectedBuildingEntrances.length ? selectedBuildingEntrances.map((node) => <div key={node.id} className="flex justify-between gap-2 py-1 text-xs"><span>{node.name}</span><span className="text-[#6b7280]">{node.status === "Inactive" ? "Inactive" : "Active"}</span></div>) : <p className="mt-2 text-xs text-amber-700">No active Entrance Route Node. Add one to make this Building routable.</p>}
                </section>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedLocation ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Location</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Location name
                  <input aria-label="Location name" value={selectedLocation.name} onChange={(event) => updateLocation({ ...selectedLocation, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <div className="text-xs text-[#3f4941]">{selectedLocation.type} · Positioned</div>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Name</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.name}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Type</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.type}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Building</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.building || "CCSICT Building"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Floor</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.floor || "1st Floor"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Latitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.lat?.toFixed(6) || "—"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Longitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.lng?.toFixed(6) || "—"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={handleStartMoveMarker}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Move Marker
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedNode ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Route Node</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node name
                  <input aria-label="Route Node name" value={selectedNode.name} onChange={(event) => updateNode({ ...selectedNode, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node type
                  <select aria-label="Route Node type" value={selectedNode.nodeType} onChange={(event) => { const nodeType = event.target.value as RouteNode["nodeType"]; updateNode({ ...selectedNode, nodeType, associatedPlaceId: nodeType === "Entrance" ? selectedNode.associatedPlaceId : null }); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                    <option>Entrance</option><option>Junction</option><option>Access Point</option>
                  </select>
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Associated Building
                  <select aria-label="Associated Location" value={selectedNode.associatedPlaceId ?? ""} onChange={(event) => updateNode({ ...selectedNode, associatedPlaceId: event.target.value || null })} disabled={selectedNode.nodeType !== "Entrance"} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs disabled:bg-[#f8f9fa]">
                    <option value="">None</option>
                    {selectedNode.associatedPlaceId && !currentLocations.some((location) => location.id === selectedNode.associatedPlaceId) && (
                      <option value={selectedNode.associatedPlaceId}>Missing Location ({selectedNode.associatedPlaceId})</option>
                    )}
                    {currentLocations.filter((location) => location.type === "Building").map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </label>
                <div className="text-xs text-[#3f4941]">{selectedNode.nodeType}</div>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Node Type</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.nodeType}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Latitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.lat.toFixed(6)}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Longitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.lng.toFixed(6)}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Connected Paths</dt>
                    <dd className="text-[#191c1d] font-bold">
                      {
                        directoryPathways.filter(
                          (p) =>
                            p.sourceNodeId === selectedNode.id ||
                            p.destinationNodeId === selectedNode.id,
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={handleStartMoveNode}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Move Node
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedPath ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Connection</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Pathway name
                  <input aria-label="Pathway name" value={selectedPath.name} onChange={(event) => updatePathway({ ...selectedPath, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Source</dt>
                    <dd><select aria-label="Pathway source" value={selectedPath.sourceNodeId} onChange={(event) => updatePathway({ ...selectedPath, sourceNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Destination</dt>
                    <dd><select aria-label="Pathway destination" value={selectedPath.destinationNodeId} onChange={(event) => updatePathway({ ...selectedPath, destinationNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Distance</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.distance}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Walking Time</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.time}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Intermediate Points</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.pathPoints?.length || 0}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPathId(selectedPath.id);
                      setPathPoints(selectedPath.pathPoints || []);
                      setMode("path");
                    }}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Edit Path Points
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        )}

        {(mode === "select" || selected?.type === "path_point") && inspectorModel && (
          <InspectorCardHUD object={inspectorModel} onClose={() => setSelected(null)} />
        )}

        <div className="absolute bottom-4 left-4 z-[900] bg-white/95 backdrop-blur-md p-4 rounded-[24px] shadow-lg border border-[#e1e3e4] w-52 pointer-events-auto">
          <div className="flex items-center justify-between text-xs font-extrabold text-[#191c1d] mb-2">
            <span>Map Legend</span>
            <svg className="w-4 h-4 text-[#3f4941]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="flex flex-col gap-2 text-[11px] font-semibold text-[#3f4941]">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#005931] border-2 border-white ring-1 ring-[#005931]"></span>
              <span>Campus Location</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#2563eb] border-2 border-white ring-1 ring-[#1d4ed8]"></span>
              <span>Route Node</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-white border-2 border-[#005931]"></span>
              <span>Path Point</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 border-t-2 border-dashed border-amber-600"></span>
              <span>Walking Path</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-2.5 bg-[#8fd1bd]/50 border border-[#278b70]"></span>
              <span>Building Footprint</span>
            </div>
          </div>
        </div>
      </div>

      {ownerModal === "location" && locationModalEntity && (
        <LocationDetailsModal
          location={locationModalEntity}
          directory={currentLocations}
          onClose={() => setOwnerModal(null)}
          onSubmit={(updated) => {
            if (selectedBuilding) {
              const updatedBuilding: Building = {
                ...selectedBuilding,
                name: updated.name,
                code: updated.code,
                status: updated.status,
              };
              updateBuilding(updatedBuilding);
              if (selectedBuildingLocation) updateLocation({ ...updated, id: selectedBuildingLocation.id });
              recordPropertyOperation("Locations", selectedBuilding.id, selectedBuilding, updatedBuilding, `Edit ${selectedBuilding.name} details`);
            } else if (selectedLocation) {
              updateLocation(updated);
              recordPropertyOperation("Locations", selectedLocation.id, selectedLocation, updated, `Edit ${selectedLocation.name} details`);
            }
            setOwnerModal(null);
          }}
        />
      )}

      {ownerModal === "route" && (selectedNode || selectedPath) && (
        <RouteDetailsModal
          entity={selectedNode ? { kind: "route_node", value: selectedNode } : { kind: "pathway", value: selectedPath! }}
          nodes={currentNodes}
          locations={currentLocations}
          onClose={() => setOwnerModal(null)}
          onSubmit={(updated) => {
            if ("nodeType" in updated && selectedNode) {
              updateNode(updated);
              recordPropertyOperation("Routes & Paths", selectedNode.id, selectedNode, updated, `Edit ${selectedNode.name} details`);
            } else if ("pathPoints" in updated && selectedPath) {
              updatePathway(updated);
              recordPropertyOperation("Routes & Paths", selectedPath.id, selectedPath, updated, `Edit ${selectedPath.name} details`);
            }
            setOwnerModal(null);
          }}
        />
      )}

      {ownerModal === "local_feature" && selectedLocalFeature && selectedLocalFeature.isEditable && (
        <LocalFeatureDetailsModal
          feature={selectedLocalFeature}
          onClose={() => setOwnerModal(null)}
          onSubmit={(updated) => {
            setLocalFeatureChanges((items) => [...items.filter((item) => item.id !== updated.id), updated]);
            recordPropertyOperation("Local Map Data", selectedLocalFeature.id, selectedLocalFeature, updated, `Edit ${selectedLocalFeature.name} details`);
            setOwnerModal(null);
          }}
        />
      )}

      {addLocationOpen && (
        <Modal title="Add Location" subtitle="Create a positioned location at the selected map coordinates." size="sm" variant="green" onClose={() => setAddLocationOpen(false)}>
          <label className="block text-xs font-semibold text-[#3f4941]">Name
            <input aria-label="New location name" value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Code
            <input aria-label="New location code" value={newLocation.code} onChange={(e) => setNewLocation({ ...newLocation, code: e.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Type
            <select aria-label="New location type" value={newLocation.type} onChange={(e) => setNewLocation({ ...newLocation, type: e.target.value as Location["type"] })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm"><option>Facility</option><option>Building</option><option>Room</option><option>Office</option></select>
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Parent Building
            <select aria-label="New location parent building" disabled={Boolean(newLocation.parentId)} value={newLocation.parentId ?? ""} onChange={(e) => { const building = currentBuildings.find((item) => item.id === e.target.value); setNewLocation({ ...newLocation, parentId: e.target.value || null, building: building?.name ?? "" }); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm"><option value="">None / Standalone</option>{currentBuildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Floor
            <input aria-label="New location floor" value={newLocation.floor} onChange={(e) => setNewLocation({ ...newLocation, floor: e.target.value })} placeholder="2nd Floor" className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <div className="mt-3 text-xs text-[#3f4941]">{temporary ? `Latitude: ${temporary[0].toFixed(6)} · Longitude: ${temporary[1].toFixed(6)}` : "This room will be added without a map position."}</div>
          <div className="modal-actions"><Button variant="subtle" onClick={() => setAddLocationOpen(false)}>Cancel</Button><Button disabled={!newLocation.name.trim() || !newLocation.code.trim()} onClick={handleSaveNewLocation}>Add Location</Button></div>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={
            confirm === "save" ? "Save Draft?" : confirm === "publish" ? "Publish Map?" : "Discard Draft?"
          }
          subtitle={
            confirm === "save"
              ? "Save every uncommitted Working Session operation as one atomic batch."
              : confirm === "publish"
                ? "Run authoritative validation before promoting this Admin Draft."
                : "Reset the shared Admin Draft and this Working Session to the published baseline."
          }
          size="sm"
          variant={confirm === "discard" ? "danger" : "green"}
          onClose={() => setConfirm(null)}
        >
          <p className="text-xs text-[#3f4941] my-2">
            {confirm === "save"
              ? `${workingSessionState.uncommittedCount} operation${workingSessionState.uncommittedCount === 1 ? "" : "s"} will be committed together against Draft v${draftVersion}.`
              : confirm === "publish"
                ? `Draft v${draftVersion} will be revalidated by the backend before publication.`
                : "Saved draft changes and local operations after the current published revision will be lost."}
          </p>
          {error && (
            <div className="p-2 my-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Button
              variant="subtle"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={commit}
              disabled={lifecycleBusy}
              variant={confirm === "discard" ? "danger" : "primary"}
            >
              {confirm === "save" ? "Confirm Save Draft" : confirm === "publish" ? "Validate & Publish" : "Confirm Discard Draft"}
            </Button>
          </div>
        </Modal>
      )}
      {conflictReview && (
        <Modal
          title="Conflict Review"
          subtitle="Another administrator changed the Admin Draft. Your local Working Session is preserved."
          size="md"
          variant="danger"
          onClose={() => setConflictReview(null)}
        >
          <div className="my-3 space-y-3">
            {conflictReview.entities.map((conflict, index) => (
              <section key={`${conflict.entityId}-${conflict.field}-${index}`} className="rounded-xl border border-red-100 p-3">
                <h3 className="text-sm font-bold text-[#191c1d]">{conflict.entityId} · {conflict.field}</h3>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-red-700">{conflict.conflictType}</p>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="font-bold text-[#3f4941]">Server value</dt><dd className="mt-1 break-words">{JSON.stringify(conflict.serverValue)}</dd></div>
                  <div><dt className="font-bold text-[#3f4941]">Your value</dt><dd className="mt-1 break-words">{JSON.stringify(conflict.clientValue)}</dd></div>
                </dl>
              </section>
            ))}
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setConflictReview(null)}>Keep Working Session</Button>
            <Button onClick={() => {
              setDraftVersion(conflictReview.serverDraftVersion);
              setConflictReview(null);
              setConfirm("save");
            }}>Retry Against Draft v{conflictReview.serverDraftVersion}</Button>
          </div>
        </Modal>
      )}
      {previewOpen && (
        <Modal
          title="Preview Map"
          subtitle="Validate pending map output and review changes before saving."
          size="md"
          variant={draftReview.valid ? "green" : "danger"}
          onClose={() => setPreviewOpen(false)}
        >
          {draftReview.errors.length > 0 ? (
            <div className="space-y-2 my-3">
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl">
                Correct {draftReview.errors.length} validation {draftReview.errors.length === 1 ? "error" : "errors"} before saving.
              </div>
              {draftReview.errors.map((validationError, index) => (
                <button
                  key={`${validationError.object.type}-${validationError.object.id}-${index}`}
                  type="button"
                  onClick={() => focusObject(
                    validationError.object,
                    validationError.message === "Associated Location does not exist."
                      ? "Associated Location"
                      : validationError.message === "Building code is required."
                        ? "Building code"
                        : validationError.message === "Building name is required."
                          ? "Building name"
                        : undefined,
                  )}
                  className="w-full text-left p-3 border border-red-100 rounded-xl hover:bg-red-50"
                >
                  <span className="block text-xs font-bold text-[#191c1d]">{validationError.object.label}</span>
                  <span className="block text-xs text-red-700 mt-1">{validationError.message}</span>
                </button>
              ))}
            </div>
          ) : draftReview.groups.length === 0 ? (
            <p className="my-4 text-sm text-[#3f4941]">No pending changes.</p>
          ) : (
            <div className="space-y-3 my-3">
              {draftReview.groups.map((group) => (
                <section key={group.kind}>
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#005931]">{group.kind} ({group.objects.length})</h3>
                  <ul className="mt-1 space-y-1">
                    {group.objects.map((object) => (
                      <li key={`${group.kind}-${object.type}-${object.id}`}>
                        <button type="button" onClick={() => focusObject(object)} className="text-xs text-left text-[#191c1d] hover:underline">
                          {object.label} <span className="text-[#3f4941]">· {object.type}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setPreviewOpen(false)}>Close</Button>
            {draftReview.valid && draftReview.groups.length > 0 && (
              <Button onClick={() => { setPreviewOpen(false); setConfirm("save"); }}>Continue to Save</Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
