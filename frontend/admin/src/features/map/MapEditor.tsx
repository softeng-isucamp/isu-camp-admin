import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { polygonCentroid, polygonFeatureAnchor, polygonIsNonDegenerate, polygonSelfIntersects, reviewMapDraft, translatePolygon, validatePathwayDraft, validateRouteNodeDraft, withoutEndpointPathPoints, type MapObjectReference } from "./mapEditing";
import { ToolInterruptionDialog, ToolRailDock } from "./ToolRailDock";
import { handleWorkingSessionKeyboardShortcut, WorkingSessionManager } from "./WorkingSessionManager";
import { InspectorCardHUD, type InspectorCardModel } from "./InspectorCardHUD";
import { LocalFeatureDetailsModal } from "./LocalFeatureDetailsModal";
import { BuildingDetailsModal } from "./BuildingDetailsModal";
import { NetworkBrowser, type NetworkBrowserSelection } from "./NetworkBrowser";
import {
  buildRestoreLocalFeatureOperation,
  buildRetireLocalFeatureOperation,
  EDITABLE_LOCAL_FEATURE_FAMILIES,
} from "./localFeatures";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import {
  normalizeMapLayers,
  type FeatureLinkEntity,
  type LocalFeatureFamily,
  type LocalMapFeatureEntity,
  type SaveDraftResult,
} from "../../services/mapEditorApiClient";
import type { ActiveToolDraft, SpatialDomain, ToolType, WorkingOperation } from "./types";
import { standardFloorLevels } from "../../lib/locationPolicy";
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
import { previewWalkingNetworkImport, type WalkingNetworkImportPreview } from "../../services/walkingNetworkImport";
import type { NetworkSnapshot } from "../../services/network";
import { buildLifecycleChange, calculateLifecycleImpact, lifecycleActionLabel, type LifecycleAction, type LifecycleImpact } from "./routeNodeLifecycle";
import {
  findSelectionCandidates,
  type CanvasSelectionType,
  type SelectionCandidate,
} from "./selectionCandidates";
import {
  buildAttachBuildingCompoundOperation,
  buildCreateBuildingCompoundOperation,
  detectBuildingFootprintOverlap,
  getBuildingAttachmentEligibility,
  validateBuildingFootprintGeometry,
  validateBuildingIdentityDetails,
  type BuildingIdentityInput,
} from "./buildingFootprint";
import "leaflet/dist/leaflet.css";

// ============================================================================
// Types & Utilities
// ============================================================================

type ProjectedCollection = "locations" | "nodes" | "pathways" | "buildings" | "localFeatures" | "featureLinks";

interface OperationProjection {
  collection: ProjectedCollection;
  entityId: string;
  value: Record<string, unknown> | null;
}

/**
 * Projects a WorkingOperation onto its affected collections based on domain and direction.
 * Used during undo/redo to apply operations to local state collections.
 */
function projectWorkingSessionOperation(
  operation: WorkingOperation,
  direction: "undo" | "redo",
  context?: {
    featureLinks?: readonly FeatureLinkEntity[];
    localFeatures?: readonly LocalMapFeatureEntity[];
  },
): OperationProjection[] {
  if (operation.type === "compound_batch" && operation.nestedOperations) {
    const list = direction === "undo"
      ? [...operation.nestedOperations].reverse()
      : operation.nestedOperations;
    const batchFeatures: LocalMapFeatureEntity[] = [];
    const batchLinks: FeatureLinkEntity[] = [];
    for (const nested of operation.nestedOperations) {
      if (nested.domain === "Local Map Data") {
        if (nested.type === "link_feature" || nested.type === "unlink_feature") {
          const l = (nested.after ?? nested.before) as FeatureLinkEntity | null;
          if (l) batchLinks.push(l);
        } else if (nested.type === "create_entity" || nested.type === "update_geometry" || nested.type === "retire_entity") {
          const f = (nested.after ?? nested.before) as LocalMapFeatureEntity | null;
          if (f) batchFeatures.push(f);
        }
      }
    }
    const combinedContext = {
      featureLinks: [...batchLinks, ...(context?.featureLinks ?? [])],
      localFeatures: [...batchFeatures, ...(context?.localFeatures ?? [])],
    };
    return list.flatMap((nested) => projectWorkingSessionOperation(nested, direction, combinedContext));
  }

  const value = direction === "undo" ? operation.before : operation.after;

  // Map domain + type to affected collections
  if (operation.domain === "Locations") {
    const projections: OperationProjection[] = [{ collection: "locations", entityId: operation.entityId, value }];
    const candidate = (value ?? (direction === "undo" ? operation.before : operation.after)) as Record<string, unknown> | null;
    if (candidate && (candidate.type === "Building" || "points" in candidate)) {
      projections.push({ collection: "buildings", entityId: operation.entityId, value });
    }
    return projections;
  } else if (operation.domain === "Walking Network") {
    // Pathways and nodes are in the same domain
    if (operation.type === "update_geometry" || operation.type === "create_entity" || operation.type === "retire_entity" || operation.type === "restore_entity" || operation.type === "update_properties") {
      // Determine if it's a pathway or node by checking the record structure
      if (value && typeof value === "object" && ("sourceNodeId" in value || "destinationNodeId" in value)) {
        return [{ collection: "pathways", entityId: operation.entityId, value }];
      } else {
        return [{ collection: "nodes", entityId: operation.entityId, value }];
      }
    }
    return [{ collection: "nodes", entityId: operation.entityId, value }];
  } else if (operation.domain === "Local Map Data") {
    if (operation.type === "link_feature" || operation.type === "unlink_feature") {
      const projections: OperationProjection[] = [{ collection: "featureLinks", entityId: operation.entityId, value }];
      const link = (operation.type === "link_feature" ? operation.after : operation.before) as FeatureLinkEntity | null;
      if (link && link.targetDomain === "Locations" && link.linkType === "building_footprint") {
        const footprint = context?.localFeatures?.find((feat) => feat.id === link.featureId);
        const shouldHaveFootprint = direction === "undo"
          ? operation.type === "unlink_feature"
          : operation.type === "link_feature";
        projections.push({
          collection: "buildings",
          entityId: link.targetEntityId,
          value: shouldHaveFootprint
            ? { id: link.targetEntityId, points: footprint?.coordinates ?? [] }
            : { id: link.targetEntityId, points: [] },
        });
      }
      return projections;
    }
    const projections: OperationProjection[] = [{ collection: "localFeatures", entityId: operation.entityId, value }];
    const feat = (value ?? (direction === "undo" ? operation.before : operation.after)) as Partial<LocalMapFeatureEntity> | null;
    if (feat && feat.family === "building_footprint") {
      const link = context?.featureLinks?.find(
        (item) => item.featureId === feat.id && item.targetDomain === "Locations" && item.linkType === "building_footprint",
      );
      const targetBuildingId = link?.targetEntityId ?? feat.linkedBuildingId;
      if (targetBuildingId) {
        projections.push({
          collection: "buildings",
          entityId: targetBuildingId,
          value: direction === "undo"
            ? { id: targetBuildingId, points: [] }
            : { id: targetBuildingId, points: feat.coordinates ?? [] },
        });
      }
    }
    return projections;
  }

  // Fallback for building operations (these might come through as Locations domain)
  if (value && typeof value === "object" && "points" in value) {
    return [{ collection: "buildings", entityId: operation.entityId, value }];
  }

  return [];
}

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

const pointIcons = new Map<boolean, L.DivIcon>();
const createPointIcon = (selected = false) => {
  const existing = pointIcons.get(selected);
  if (existing) return existing;
  const icon = L.divIcon({
    className: `path-point-icon ${selected ? "selected" : ""}`,
    html: `<div class="point-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
  pointIcons.set(selected, icon);
  return icon;
};

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
  frameBounds: [[number, number], [number, number]] | null;
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
  frameBounds,
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
    if (frameBounds && typeof map.fitBounds === "function") {
      map.fitBounds(frameBounds, { padding: [48, 48], maxZoom: 19 });
    }
  }, [frameBounds, map]);

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

export function MapEditor() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [workingSessionManager] = useState(() => new WorkingSessionManager());
  const [draftVersion, setDraftVersion] = useState(1);
  const saveRequestId = useRef(`map-save-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
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
    queryKey: ["map-editor-bootstrap", "proj-echague"],
    queryFn: () => services.map.getMapEditorBootstrap!("proj-echague"),
    enabled: Boolean(services.map.getMapEditorBootstrap),
    retry: false,
  });
  const { data: buildingDirectory } = useQuery({
    queryKey: ["locations", "building-options"],
    queryFn: async () => (await services.locations.list("", 1, 100, { type: "Building" })).items,
    retry: false,
  });

  useEffect(() => {
    if (draftBootstrap) setDraftVersion(draftBootstrap.adminDraft.draftVersion);
  }, [draftBootstrap]);

  const [localLocations, setLocalLocations] = useState<Location[]>([]);
  const [localNodes, setLocalNodes] = useState<RouteNode[]>([]);
  const [localPathways, setLocalPathways] = useState<Pathway[]>([]);
  const [deletedPathwayIds, setDeletedPathwayIds] = useState<string[]>([]);
  const [localBuildings, setLocalBuildings] = useState<Building[]>([]);
  const [localFeatureChanges, setLocalFeatureChanges] = useState<LocalMapFeatureEntity[]>([]);
  const [localFeatureLinks, setLocalFeatureLinks] = useState<FeatureLinkEntity[]>([]);
  const [unlinkedFeatureLinkIds, setUnlinkedFeatureLinkIds] = useState<string[]>([]);
  const [selectedLocalFeatureFamily, setSelectedLocalFeatureFamily] = useState<Exclude<LocalFeatureFamily, "readonly_basemap">>("parking_area");
  const [localFeaturePoints, setLocalFeaturePoints] = useState<[number, number][]>([]);
  const [localFeatureName, setLocalFeatureName] = useState("New Parking Area");
  const [ownerModal, setOwnerModal] = useState<"location" | "local_feature" | null>(null);
  const [localFeatureActionNotice, setLocalFeatureActionNotice] = useState("");

  const [mode, setMode] = useState<"select" | "place" | "path" | "area" | "move" | "local_feature">(
    "select",
  );
  const [selected, setSelected] = useState<{
    type: "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature";
    id: string;
  } | null>(null);
  const [selectionPopover, setSelectionPopover] = useState<{
    anchor: MapPoint;
    candidates: SelectionCandidate[];
  } | null>(null);

  const [search, setSearch] = useState("");
  const [networkBrowserOpen, setNetworkBrowserOpen] = useState(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [frameBounds, setFrameBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [temporary, setTemporary] = useState<[number, number] | null>(null);
  const [pointDraftDirty, setPointDraftDirty] = useState(false);
  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [manualPathPointDrag, setManualPathPointDrag] = useState(false);
  const [pathPointDragPreview, setPathPointDragPreview] = useState<{
    index: number;
    point: [number, number];
  } | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [polygonInteraction, setPolygonInteraction] = useState<"draw" | "reshape" | "move">("draw");
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [buildingWorkflowMode, setBuildingWorkflowMode] = useState<"create" | "attach">("create");
  const [buildingDetailsModalOpen, setBuildingDetailsModalOpen] = useState(false);
  const [buildingClassification, setBuildingClassification] = useState<"Building" | "Facility">("Building");
  const [attachBuildingSearch, setAttachBuildingSearch] = useState("");
  const [selectedAttachBuildingId, setSelectedAttachBuildingId] = useState<string | null>(null);
  const [nonRoutableBuildingId, setNonRoutableBuildingId] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState<BuildingIdentityInput>({
    name: "",
    code: "",
    function: "",
    keywords: "",
    status: "Active",
  });
  const buildingName = buildingForm.name;
  const buildingCode = buildingForm.code;
  const buildingFunction = buildingForm.function ?? "";
  const buildingKeywords = buildingForm.keywords ?? "";
  const updateBuildingField = (field: keyof BuildingIdentityInput, value: string) => {
    setBuildingForm((current) => ({ ...current, [field]: value }));
  };
  const resetBuildingForm = () => {
    setBuildingForm({ name: "", code: "", function: "", keywords: "", status: "Active" });
    setBuildingClassification("Building");
  };
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<MapPoint | null>(null);
  const [lastValidMovePosition, setLastValidMovePosition] = useState<MapPoint | null>(null);
  const [isPointDragging, setIsPointDragging] = useState(false);
  const [pointIsSnapped, setPointIsSnapped] = useState(false);
  const [moveDropRejected, setMoveDropRejected] = useState(false);
  const [placingNodeType, setPlacingNodeType] = useState<
    "Entrance" | "Junction" | "Access Point"
  >("Entrance");
  const [placingNodeName, setPlacingNodeName] = useState("");
  const [placingAssociatedBuildingId, setPlacingAssociatedBuildingId] = useState<
    string | null
  >(null);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", code: "", floor: "" });
  const [buildingIndoorFloor, setBuildingIndoorFloor] = useState<string>(standardFloorLevels[0]);
  const [linkingBuildingEntrance, setLinkingBuildingEntrance] = useState(false);

  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [pathwayDraft, setPathwayDraft] = useState<Pathway | null>(null);
  const [pathwayDraftOriginal, setPathwayDraftOriginal] = useState<Pathway | null>(null);
  const [provisionalPathwayId, setProvisionalPathwayId] = useState<string | null>(null);
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [pathDraftDirty, setPathDraftDirty] = useState(false);
  const [routeNodeDraft, setRouteNodeDraft] = useState<RouteNode | null>(null);
  const [routeNodeDraftOriginal, setRouteNodeDraftOriginal] = useState<RouteNode | null>(null);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const distinctBuildingPointCount = new Set(points.map((point) => point.join(","))).size;
  const polygonInvalid = polygonSelfIntersects(points) || !polygonIsNonDegenerate(points);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "discard" | null>(null);
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState<{ action: LifecycleAction; impact: LifecycleImpact } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [basemap, setBasemap] = useState<"street" | "satellite">("street");
  const [currentMapBounds, setCurrentMapBounds] = useState<L.LatLngBounds | null>(null);
  const [walkingNetworkImport, setWalkingNetworkImport] = useState<WalkingNetworkImportPreview | null>(null);
  const [importAdvisoriesAcknowledged, setImportAdvisoriesAcknowledged] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);



  const completeToolDraft = (toolType: Exclude<ToolType, "select">) => {
    const completionHandlers: Record<Exclude<ToolType, "select">, () => void> = {
      point: () => setPointDraftDirty(false),
      polygon: () => undefined,
      pathway: () => {
        setPathDraftDirty(false);
        setProvisionalPathwayId(null);
      },
      local_feature: () => undefined,
    };
    completionHandlers[toolType]();
    workingSessionManager.discardActiveDraft();
  };
  const handleViewportChange = useCallback((bounds: L.LatLngBounds | null) => {
    setCurrentMapBounds(bounds);
  }, []);

  const directoryLocations = data?.locations || [];
  const directoryNodes = data?.nodes || [];
  const directoryPathways = data?.pathways || [];
  const directoryBuildings = (data?.buildings || []).filter((building) => building.points.length >= 3);
  const directoryMapLayers = useMemo(() => normalizeMapLayers({
    buildings: data?.buildings || [],
    locations: data?.locations || [],
    routeNodes: data?.nodes || [],
    pathways: data?.pathways || [],
  }), [data?.buildings, data?.locations, data?.nodes, data?.pathways]);
  const currentFeatureLinks = [...directoryMapLayers.featureLinks, ...localFeatureLinks]
    .filter((link) => !unlinkedFeatureLinkIds.includes(link.id));
  const currentLocations = useMemo(() => overlayChanges(directoryLocations, localLocations), [directoryLocations, localLocations]);
  const currentNodes = useMemo(() => overlayChanges(directoryNodes, localNodes), [directoryNodes, localNodes]);
  const currentPathways = useMemo(() => {
    const merged = overlayChanges(directoryPathways, localPathways);
    const visible = merged.filter((item) => !deletedPathwayIds.includes(item.id));
    return editingPathId ? visible.map((item) => item.id === editingPathId
      ? { ...item, ...(pathwayDraft?.id === editingPathId ? pathwayDraft : {}), pathPoints }
      : item) : visible;
  }, [deletedPathwayIds, directoryPathways, editingPathId, localPathways, pathwayDraft, mode, pathPoints]);
  const pathwayCrossings = useMemo(
    () => findPathwayCrossings(currentPathways, currentNodes),
    [currentNodes, currentPathways],
  );
  const sessionBuildings = useMemo(() => {
    return overlayChanges(data?.buildings || [], localBuildings);
  }, [data?.buildings, localBuildings]);
  const allSessionBuildings = useMemo(() => {
    const buildingMap = new Map<string, Building>();
    for (const loc of currentLocations) {
      if (loc.type === "Building" || loc.type === "Facility") {
        buildingMap.set(loc.id, {
          id: loc.id,
          name: loc.name,
          code: loc.code,
          type: loc.type === "Facility" ? "Facility" : "Building",
          status: loc.status ?? "Active",
          points: [],
        });
      }
    }
    for (const bld of sessionBuildings) {
      const existing = buildingMap.get(bld.id);
      buildingMap.set(bld.id, {
        ...existing,
        ...bld,
      });
    }
    return Array.from(buildingMap.values());
  }, [currentLocations, sessionBuildings]);
  const buildingAssociationOptions = useMemo(() => {
    const buildingMap = new Map<string, Building>();
    for (const location of buildingDirectory ?? []) {
      if (location.type !== "Building") continue;
      buildingMap.set(location.id, {
        id: location.id,
        name: location.name,
        code: location.code,
        type: "Building",
        status: location.status,
        points: [],
      });
    }
    for (const building of allSessionBuildings) {
      if (building.type === "Facility") continue;
      const existing = buildingMap.get(building.id);
      buildingMap.set(building.id, { ...existing, ...building, type: "Building" });
    }
    return Array.from(buildingMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [allSessionBuildings, buildingDirectory]);
  const buildingAttachmentEligibility = (building: Building) =>
    getBuildingAttachmentEligibility(building, currentFeatureLinks);
  const selectedAttachBuilding = buildingAssociationOptions.find((b) => b.id === selectedAttachBuildingId);
  const selectedAttachEligibility = selectedAttachBuilding ? buildingAttachmentEligibility(selectedAttachBuilding) : null;
  const attachCandidateBuildings = useMemo(() => {
    const query = attachBuildingSearch.trim().toLowerCase();
    return buildingAssociationOptions.filter((building) => {
      if (building.id === "pending-building" || building.id === editingBuildingId) return false;
      const eligibility = getBuildingAttachmentEligibility(building, currentFeatureLinks);
      if (!eligibility.eligible) return false;
      return !query || `${building.name} ${building.code}`.toLowerCase().includes(query);
    });
  }, [attachBuildingSearch, buildingAssociationOptions, currentFeatureLinks, editingBuildingId]);
  const currentBuildings = useMemo(() => {
    const validMerged = sessionBuildings.filter((building) => building.points.length >= 3);
    if (mode !== "area" || points.length === 0) return validMerged;
    const pending: Building = { id: editingBuildingId ?? "pending-building", name: buildingName, code: buildingCode, points };
    return editingBuildingId && validMerged.some((building) => building.id === editingBuildingId)
      ? validMerged.map((building) => building.id === editingBuildingId ? pending : building)
      : [...validMerged, pending];
  }, [buildingCode, buildingName, editingBuildingId, mode, points, sessionBuildings]);
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
        ...(source && !(mode === "move" && source.id === movingId)
          ? [[source.lat, source.lng] as MapPoint]
          : []),
        ...pathway.pathPoints,
        ...(destination && !(mode === "move" && destination.id === movingId)
          ? [[destination.lat, destination.lng] as MapPoint]
          : []),
      ].map((point) => ({ kind: "pathway_vertex" as const, point }));
    }),
  ], [currentBuildings, currentNodes, currentPathways, mode, movingId]);
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
    () => overlayChanges(normalizedLocalFeatures, localFeatureChanges),
    [localFeatureChanges, normalizedLocalFeatures],
  );

  const applyWorkingSessionOperation = useCallback((operation: WorkingOperation | null, direction: "undo" | "redo") => {
    if (!operation) return;
    const replaceProjection = <T extends { id: string }>(items: T[], entityId: string, value: Record<string, unknown> | null) =>
      value === null
        ? items.filter((item) => item.id !== entityId)
        : [...items.filter((item) => item.id !== entityId), value as unknown as T];
    const handlers: Record<ProjectedCollection, (entityId: string, value: Record<string, unknown> | null) => void> = {
      locations: (entityId, value) => setLocalLocations((items) => replaceProjection(items, entityId, value)),
      nodes: (entityId, value) => setLocalNodes((items) => replaceProjection(items, entityId, value)),
      pathways: (entityId, value) => {
        setLocalPathways((items) => replaceProjection(items, entityId, value));
        setDeletedPathwayIds((ids) => value === null
          ? [...new Set([...ids, entityId])]
          : ids.filter((id) => id !== entityId));
      },
      buildings: (entityId, value) => setLocalBuildings((items) => {
        if (value === null) return items.filter((item) => item.id !== entityId);
        const existing = items.find((item) => item.id === entityId)
          ?? data?.buildings?.find((item) => item.id === entityId);
        const merged = existing ? { ...existing, ...value } : value;
        return [...items.filter((item) => item.id !== entityId), merged as unknown as Building];
      }),
      localFeatures: (entityId, value) => setLocalFeatureChanges((items) => replaceProjection(items, entityId, value)),
      featureLinks: (entityId, value) => setLocalFeatureLinks((items) => replaceProjection(items, entityId, value)),
    };
    projectWorkingSessionOperation(operation, direction, {
      featureLinks: currentFeatureLinks,
      localFeatures: currentLocalFeatures,
    }).forEach((projection) => {
      handlers[projection.collection](projection.entityId, projection.value);
    });
    setDirty(workingSessionManager.getIsDirty());
  }, [currentFeatureLinks, currentLocalFeatures, data?.buildings, workingSessionManager]);

  useEffect(() => {
    const onWorkingSessionShortcut = (event: KeyboardEvent) => {
      handleWorkingSessionKeyboardShortcut(event, workingSessionManager, {
        onUndo: (operation) => applyWorkingSessionOperation(operation, "undo"),
        onRedo: (operation) => applyWorkingSessionOperation(operation, "redo"),
      });
    };
    window.addEventListener("keydown", onWorkingSessionShortcut);
    return () => window.removeEventListener("keydown", onWorkingSessionShortcut);
  }, [applyWorkingSessionOperation, workingSessionManager]);
  // Local map features are retained by the data/service layer for compatibility,
  // but are intentionally not rendered in this editor. The campus boundary is
  // still used below for validation and navigation bounds.
  const campusBoundary = useMemo(
    () => directoryBuildings.find((building) => building.code === "CAMPUS_00" || /whole isu campus/i.test(building.name))?.points ?? echagueCampusBoundary,
    [directoryBuildings],
  );
  const selectedLocalFeatureDefinition = EDITABLE_LOCAL_FEATURE_FAMILIES.find(
    (family) => family.id === selectedLocalFeatureFamily,
  )!;
  const localFeatureMinimumPoints = selectedLocalFeatureDefinition.geometryType === "line" ? 2 : 3;
  const localFeaturePolygonInvalid = mode === "local_feature"
    && selectedLocalFeatureDefinition.geometryType === "polygon"
    && localFeaturePoints.length >= 3
    && validateBuildingFootprintGeometry(localFeaturePoints, campusBoundary).length > 0;
  const canCreateLocalFeature = selectedLocalFeatureFamily === "building_footprint"
    || (localFeatureName.trim().length > 0 && localFeaturePoints.length >= localFeatureMinimumPoints
      && !localFeaturePolygonInvalid);
  const displaysOsmOverlays = [...currentBuildings, ...currentLocations, ...currentNodes, ...currentPathways]
    .some((item) => item.source?.provider === "OpenStreetMap");
  const footprintGeometryIssues = useMemo(
    () => mode === "area" ? validateBuildingFootprintGeometry(points, campusBoundary) : [],
    [campusBoundary, mode, points],
  );
  const footprintOverlapWarning = useMemo(
    () => mode === "area"
      ? detectBuildingFootprintOverlap(points, currentBuildings, editingBuildingId ?? "pending-building")
      : null,
    [currentBuildings, editingBuildingId, mode, points],
  );
  const buildingIdentityIssues = useMemo(
    () => mode === "area" && (polygonClosed || points.length >= 3) && buildingWorkflowMode === "create"
      ? validateBuildingIdentityDetails(
          { name: buildingName, code: buildingCode, function: buildingFunction, keywords: buildingKeywords, status: "Active" },
          currentLocations,
          editingBuildingId,
        )
      : [],
    [buildingCode, buildingFunction, buildingKeywords, buildingName, buildingWorkflowMode, currentLocations, editingBuildingId, mode, points.length, polygonClosed],
  );
  const canFinishFootprint = points.length >= 3 && footprintGeometryIssues.length === 0;
  const canSaveBuilding = canFinishFootprint && buildingIdentityIssues.length === 0 && Boolean(buildingName.trim()) && Boolean(buildingCode.trim());
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
  const movingObjectName = selectedNode?.name ?? "Route Node";
  const movingOutsideBoundary = Boolean(
    mode === "move" && temporary && !pointOnCampus(temporary, campusBoundary),
  );
  const moveDistanceMeters = moveOrigin && temporary
    ? distanceInMeters(moveOrigin, temporary)
    : 0;
  const selectedBuildingLocation = selectedBuilding && currentLocations.find((location) =>
    (location.type === "Building" || location.type === "Facility")
      && (location.id === selectedBuilding.id || location.name === selectedBuilding.name));
  const selectedBuildingAssociationId = selectedBuildingLocation?.id ?? selectedBuilding?.id;
  const selectedBuildingEntrances = selectedBuilding
    ? currentNodes.filter((node) => node.nodeType === "Entrance" && (node.associatedPlaceId === selectedBuilding.id || node.associatedPlaceId === selectedBuildingAssociationId))
    : [];
  const selectedBuildingHasFootprint = Boolean(
    selectedBuilding && (
      selectedBuilding.points.length >= 3 ||
      currentFeatureLinks.some((link) => link.targetEntityId === selectedBuilding.id && link.linkType === "building_footprint")
    ),
  );
  const selectedBuildingRoutable = Boolean(
    selectedBuilding &&
    selectedBuildingHasFootprint &&
    (selectedBuildingLocation ? selectedBuildingLocation.status === "Active" : (selectedBuilding.status ?? "Active") === "Active") &&
    selectedBuildingEntrances.some((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng) && (node.status ? node.status === "Active" : true)),
  );

  useEffect(() => {
    const create = new URLSearchParams(routeLocation.search).get("create");
    if (create === "building") {
      activateTool("polygon");
      return;
    }
  }, [routeLocation.search]);

  useEffect(() => {
    const locationId = new URLSearchParams(routeLocation.search).get(
      "location",
    );
    if (locationId && directoryLocations.some((item) => item.id === locationId)) {
      const loc = directoryLocations.find((item) => item.id === locationId);
      setSelected({ type: "location", id: locationId });
      // Locations may locate an existing record, but it must never hand off
      // into a standalone point-placement workflow. Footprint geometry stays
      // owned by Map Editor's Building Polygon tool.
      setMode("select");
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
      setError("The requested Pathway is no longer available. Refresh the Walking Network and try again.");
      return;
    }
    setSelected({ type: "pathway", id: pathway.id });
    setEditingPathId(pathway.id);
    setPathwayDraft({ ...pathway });
    setPathwayDraftOriginal({ ...pathway });
    setPathPoints([...pathway.pathPoints]);
    setMode("path");
    setError("");
    const source = currentNodes.find((node) => node.id === pathway.sourceNodeId);
    if (source) setFlyTarget([source.lat, source.lng]);
  }, [currentNodes, data, directoryPathways, localPathways, routeLocation.search]);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const allLocs = directoryLocations.length ? directoryLocations : localLocations;
    const allNodes = directoryNodes.length ? directoryNodes : localNodes;
    const allPaths = currentPathways;

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
  }, [currentPathways, directoryLocations, directoryNodes, localLocations, localNodes, search]);

  const selectObject = useCallback(
    (type: "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature", id: string) => {
      setSelected({ type, id });
      if (type === "node" || type === "pathway") setNetworkBrowserOpen(true);
      setSelectionPopover(null);
      setLocalFeatureActionNotice("");
      if (type === "pathway") {
        const path = currentPathways.find((p) => p.id === id);
        if (path) {
          setPathwayDraft({ ...path });
          setPathwayDraftOriginal({ ...path });
          // Legacy Open records retain the old edit-on-selection behavior for
          // compatibility. Canonical Active records open in inspection first;
          // editing requires the explicit Edit/Reshape action.
          if (path.status === "Open") {
            setEditingPathId(path.id);
            setPathPoints(path.pathPoints || []);
            setMode("path");
          } else {
            setEditingPathId(null);
            setPathPoints([]);
            setMode("select");
          }
          setSelectedPathPointIndex(null);
        }
      }
      if (type === "node") {
        const node = currentNodes.find((candidate) => candidate.id === id);
        if (node) {
          setRouteNodeDraft({ ...node });
          setRouteNodeDraftOriginal({ ...node });
        }
      }
      setTemporary(null);
    },
    [currentNodes, currentPathways],
  );

  const selectCanvasObject = (
    type: CanvasSelectionType,
    id: string,
    anchor: MapPoint,
  ) => {
    if (mode !== "select") {
      selectObject(type, id);
      return;
    }
    const candidates = findSelectionCandidates(anchor, {
      locations: currentLocations,
      nodes: currentNodes,
      pathways: currentPathways,
      buildings: currentBuildings,
    });
    if (candidates.length <= 1) {
      selectObject(type, id);
      return;
    }
    setSelected(null);
    setSelectionPopover({ anchor, candidates });
  };

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
      const p = currentPathways.find((path) => path.id === item.id);
      if (p) {
        const src = directoryNodes.find((n) => n.id === p.sourceNodeId) || localNodes.find((n) => n.id === p.sourceNodeId);
        if (src) setFlyTarget([src.lat, src.lng]);
      }
    }
    setSearch("");
  };

  const handleNetworkBrowserSelection = (networkSelection: NonNullable<NetworkBrowserSelection>) => {
    selectObject(networkSelection.type, networkSelection.id);
    if (networkSelection.type === "node") {
      const node = currentNodes.find((item) => item.id === networkSelection.id);
      if (node) {
        setFrameBounds(null);
        setFlyTarget([node.lat, node.lng]);
      }
      return;
    }
    const pathway = currentPathways.find((item) => item.id === networkSelection.id);
    const source = pathway && currentNodes.find((node) => node.id === pathway.sourceNodeId);
    const destination = pathway && currentNodes.find((node) => node.id === pathway.destinationNodeId);
    if (pathway && source && destination) {
      const points = [[source.lat, source.lng], ...pathway.pathPoints, [destination.lat, destination.lng]] as [number, number][];
      setFrameBounds([
        [Math.min(...points.map(([lat]) => lat)), Math.min(...points.map(([, lng]) => lng))],
        [Math.max(...points.map(([lat]) => lat)), Math.max(...points.map(([, lng]) => lng))],
      ]);
    }
  };
  const networkBrowserSelection: NetworkBrowserSelection = selected && (selected.type === "node" || selected.type === "pathway")
    ? { type: selected.type, id: selected.id }
    : null;

  const onMapClick = (point: [number, number]) => {
    if (mode === "select") {
      setSelected(null);
      setSelectionPopover(null);
      return;
    }
    if (mode !== "move" && !pointOnCampus(point, campusBoundary)) {
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
    } else if (mode === "path" && editingPathId && !manualPathPointDrag) {
      setPathPoints((current) => [...current, point]);
      setPathDraftDirty(true);
    }
  };

  const closePolygon = useCallback(() => {
    if (mode !== "area" || points.length < 3) return;
    const geometryIssues = validateBuildingFootprintGeometry(points, campusBoundary);
    if (geometryIssues.length > 0) {
      setError(geometryIssues[0].message);
      return;
    }
    setPolygonClosed(true);
    setPolygonInteraction("draw");
    if (buildingWorkflowMode === "create") setBuildingDetailsModalOpen(true);
    setError("");
  }, [buildingWorkflowMode, campusBoundary, mode, points]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") closePolygon();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePolygon]);

  const updatePolygonVertex = (index: number, point: [number, number]) => {
    setPoints((current) => {
      const next = current.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate);
      if (!geometryOnCampus(next, campusBoundary)) {
        setError("The building footprint must stay inside the ISU Echague campus boundary.");
        return current;
      }
      setError("");
      return next;
    });
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

  const handleStartMoveNode = () => {
    if (!selectedNode) return;
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
    if (movingId) {
      const existing = currentNodes.find((node) => node.id === movingId);
      const updated = existing ? { ...existing, lat: temporary[0], lng: temporary[1] } : null;
      if (updated) {
        setLocalNodes((current) => {
          const filtered = current.filter((n) => n.id !== movingId);
          return [...filtered, updated];
        });
        workingSessionManager.executeOperation({
          type: "update_geometry",
          domain: "Walking Network",
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

  const handleSavePlacedNode = () => {
    if (!temporary || !placingNodeName.trim()) return;
    const newNodeId = `node-${Date.now()}`;
    const newNode: RouteNode = {
      id: newNodeId,
      name: placingNodeName.trim(),
      nodeType: placingNodeType,
      associatedPlaceId: placingNodeType === "Entrance" ? placingAssociatedBuildingId || null : null,
      lat: temporary[0],
      lng: temporary[1],
    };
    const issues = validateRouteNodeDraft(newNode, {
      buildings: currentBuildings,
      locations: currentLocations,
      campusBoundary,
    });
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }
    setLocalNodes((current) => [...current, newNode]);
    workingSessionManager.executeOperation({ type: "create_entity", domain: "Walking Network", entityId: newNode.id,
      before: null, after: newNode as unknown as Record<string, unknown>, description: `Place ${newNode.name}` });
    if (newNode.nodeType === "Entrance" && newNode.associatedPlaceId === nonRoutableBuildingId) {
      setNonRoutableBuildingId(null);
    }
    setDirty(true);
    setPlacingNodeName("");
    setMode("select");
    setSelected({ type: "node", id: newNodeId });
    completeToolDraft("point");
  };

  const handleSaveNewRoom = () => {
    if (!selectedBuilding || (selectedBuilding.type ?? selectedBuildingLocation?.type) !== "Building" || !newRoom.name.trim() || !newRoom.code.trim()) return;
    const location: Location = {
      id: `location-${Date.now()}`,
      name: newRoom.name.trim(),
      code: newRoom.code.trim(),
      type: "Room",
      status: "Active",
      parentId: selectedBuilding.id,
      building: selectedBuilding.name,
      floor: newRoom.floor.trim() || undefined,
      function: "",
      lat: null,
      lng: null,
      positioned: false,
    };
    setLocalLocations((current) => [...current, location]);
    workingSessionManager.executeOperation({ type: "create_entity", domain: "Locations", entityId: location.id,
      before: null, after: location as unknown as Record<string, unknown>, description: `Create ${location.name}` });
    setDirty(true);
    setAddRoomOpen(false);
    setLinkingBuildingEntrance(false);
    setBuildingIndoorFloor(standardFloorLevels[0]);
    setNewRoom({ name: "", code: "", floor: "" });
  };

  const openIndoorLocationHandoff = (building: Building, floor: string) => {
    const parent = currentLocations.find((location) => location.id === building.id && location.type === "Building") ?? {
      id: building.id,
      name: building.name,
      code: building.code,
      type: "Building" as const,
      parentId: null,
      status: building.status ?? "Active",
      lat: null,
      lng: null,
      positioned: false,
    };
    navigate(`/locations?add=indoor&parentId=${encodeURIComponent(building.id)}&floor=${encodeURIComponent(floor)}`, {
      state: { indoorLocationParent: parent },
    });
  };

  const linkExistingEntrance = (building: Building, node: RouteNode) => {
    const associatedPlaceId = selectedBuildingLocation?.id ?? building.id;
    const updated = { ...node, nodeType: "Entrance" as const, associatedPlaceId };
    updateNodeWithOperation(node, updated, `Link ${node.name} to ${building.name}`);
    setLinkingBuildingEntrance(false);
    setSelected({ type: "building", id: building.id });
  };

  const handleSavePathShape = () => {
    if (!editingPathId) return;
    const target = localPathways.find((pathway) => pathway.id === editingPathId) || directoryPathways.find((pathway) => pathway.id === editingPathId);
    if (target) {
      const updatedPath: Pathway = {
        ...(pathwayDraft?.id === target.id ? pathwayDraft : target),
        // A Pathway owns only intermediate geometry. Endpoint coordinates are
        // always read from the selected Route Nodes.
        pathPoints: withoutEndpointPathPoints(
          [...pathPoints],
          routeNodePoint(currentNodes, target.sourceNodeId),
          routeNodePoint(currentNodes, target.destinationNodeId),
        ),
      };
      const pathwayIssues = validatePathwayDraft(updatedPath, currentNodes, campusBoundary, {
        existingPathways: currentPathways.filter((pathway) => pathway.id !== updatedPath.id),
        requireActiveEndpoints: true,
      });
      if (pathwayIssues.length > 0) {
        setError(pathwayIssues[0].message);
        return;
      }
      setLocalPathways((current) => {
        const filtered = current.filter((p) => p.id !== editingPathId);
        return [...filtered, updatedPath];
      });
      setPathwayDraft({ ...updatedPath });
      setPathwayDraftOriginal({ ...updatedPath });
      workingSessionManager.executeOperation({
        type: provisionalPathwayId === target.id ? "create_entity" : "update_geometry",
        domain: "Walking Network",
        entityId: target.id,
        before: provisionalPathwayId === target.id ? null : target as unknown as Record<string, unknown>,
        after: updatedPath as unknown as Record<string, unknown>,
        description: provisionalPathwayId === target.id ? `Create ${updatedPath.name}` : `Reshape ${target.name}`,
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

  const cancelBuildingDraft = () => {
    setPoints([]);
    resetBuildingForm();
    setEditingBuildingId(null);
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    setPolygonClosed(false);
    setPolygonInteraction("draw");
    setMode("select");
    setError("");
    setBuildingDetailsModalOpen(false);
    completeToolDraft("polygon");
  };

  const closeBuildingDetailsModal = () => {
    setBuildingDetailsModalOpen(false);
    setError("");
  };

  const handleSaveBuilding = () => {
    if (editingBuildingId) {
      if (!canFinishFootprint) return;
      if (!geometryOnCampus(points, campusBoundary)) {
        setError("The building footprint must stay inside the ISU Echague campus boundary.");
        return;
      }
      const footprintLink = currentFeatureLinks.find((link) =>
        link.targetDomain === "Locations"
        && link.targetEntityId === editingBuildingId
        && link.linkType === "building_footprint",
      );
      const footprint = currentLocalFeatures.find((feature) =>
        feature.id === footprintLink?.featureId
        || (feature.family === "building_footprint"
          && (feature.linkedBuildingId === editingBuildingId || feature.id === `feat-poly-${editingBuildingId}`)),
      );
      if (!footprintLink || !footprint) {
        setError("This Building has no linked footprint to reshape. Open Building details to review its ownership.");
        return;
      }
      const updatedFootprint: LocalMapFeatureEntity = {
        ...footprint,
        coordinates: [...points],
        linkedBuildingId: editingBuildingId,
      };
      setLocalFeatureChanges((current) => [...current.filter((feature) => feature.id !== updatedFootprint.id), updatedFootprint]);
      setLocalBuildings((current) => current.map((building) =>
        building.id === editingBuildingId ? { ...building, points: [...points] } : building,
      ));
      workingSessionManager.executeOperation({
        type: "update_geometry",
        domain: "Local Map Data",
        entityId: updatedFootprint.id,
        before: footprint as unknown as Record<string, unknown>,
        after: updatedFootprint as unknown as Record<string, unknown>,
        description: `Reshape linked footprint for ${buildingName.trim() || editingBuildingId}`,
      });
      setDirty(true);
      cancelBuildingDraft();
      setSelected({ type: "building", id: editingBuildingId });
    } else {
      if (!canSaveBuilding) return;
      handleCreateBuilding();
    }
  };

  const completeBuildingWorkflow = (building: Building, intent: "create" | "attach") => {
    const geometryIssues = validateBuildingFootprintGeometry(points, campusBoundary);
    if (geometryIssues.length > 0) {
      setError(geometryIssues[0].message);
      return;
    }

    let compoundBatch: WorkingOperation;
    if (intent === "create") {
      const identityInput: BuildingIdentityInput = {
        name: building.name,
        code: building.code,
        type: buildingClassification,
        function: buildingFunction,
        keywords: buildingKeywords,
        status: "Active",
      };
      const identityIssues = validateBuildingIdentityDetails(identityInput, currentLocations);
      if (identityIssues.length > 0) {
        setError(identityIssues[0].message);
        return;
      }
      compoundBatch = buildCreateBuildingCompoundOperation(identityInput, points, building.id);
      const locRecord = compoundBatch.nestedOperations![0].after as unknown as Location;
      setLocalLocations((current) => [...current.filter((item) => item.id !== locRecord.id), locRecord]);
    } else {
      const eligibility = getBuildingAttachmentEligibility(building, currentFeatureLinks);
      if (!eligibility.eligible) {
        setError(eligibility.reason);
        return;
      }
      compoundBatch = buildAttachBuildingCompoundOperation(building, points);
    }

    const footprintOp = compoundBatch.nestedOperations!.find(
      (op) => op.domain === "Local Map Data" && op.type === "create_entity",
    );
    const linkOp = compoundBatch.nestedOperations!.find(
      (op) => op.domain === "Local Map Data" && op.type === "link_feature",
    );
    const footprint = footprintOp?.after as unknown as LocalMapFeatureEntity;
    const link = linkOp?.after as unknown as FeatureLinkEntity;

    // The current renderer still consumes Building.points. Keep this local
    // compatibility projection separate from the geometry-free Building
    // record stored in the compound operation above.
    const renderedBuilding = { ...building, type: buildingClassification, points: [...points] };
    setLocalBuildings((current) => [...current.filter((item) => item.id !== building.id), renderedBuilding]);
    if (footprint) {
      setLocalFeatureChanges((current) => [...current.filter((item) => item.id !== footprint.id), footprint]);
    }
    if (link) {
      setLocalFeatureLinks((current) => [...current.filter((item) => item.targetEntityId !== building.id), link]);
    }
    workingSessionManager.executeBatch(
      intent === "create" ? `Create ${building.name} with footprint` : `Attach footprint to ${building.name}`,
      "Local Map Data",
      footprint?.id ?? compoundBatch.entityId,
      compoundBatch.nestedOperations!,
    );
    setDirty(true);
    setPoints([]);
    resetBuildingForm();
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    setPolygonClosed(false);
    setPolygonInteraction("draw");
    setMode("select");
    setSelected({ type: "building", id: building.id });
    setPlacingAssociatedBuildingId(building.id);
    const hasActiveEntrance = currentNodes.some((node) =>
      node.nodeType === "Entrance"
      && node.associatedPlaceId === building.id
      && node.status !== "Inactive",
    );
    setNonRoutableBuildingId(hasActiveEntrance ? null : building.id);
    completeToolDraft("polygon");
  };

  const handleCreateBuilding = async () => {
    if (!canSaveBuilding) {
      setError(buildingIdentityIssues[0]?.message ?? "Complete the required Building details.");
      return;
    }
    const geometryIssues = validateBuildingFootprintGeometry(points, campusBoundary);
    if (geometryIssues.length > 0) {
      setError(geometryIssues[0].message);
      return;
    }

    if (typeof services.locations.save === "function") {
      setError("");
      try {
        const saved = await services.locations.save({
          name: buildingName.trim(),
          code: buildingCode.trim(),
          type: "Building",
          parentId: null,
          function: buildingFunction.trim(),
          keywords: buildingKeywords.trim() || undefined,
          status: "Active",
          lat: null,
          lng: null,
          positioned: false,
        });
        const renderedBuilding: Building = {
          id: saved.id,
          name: saved.name,
          code: saved.code,
          type: saved.type === "Facility" ? "Facility" : "Building",
          status: saved.status,
          points: [...points],
        };
        setLocalLocations((current) => [...current.filter((item) => item.id !== saved.id), saved]);
        setLocalBuildings((current) => [...current.filter((item) => item.id !== saved.id), renderedBuilding]);
        setBuildingDetailsModalOpen(false);
        setPoints([]);
        resetBuildingForm();
        setPolygonClosed(false);
        setPolygonInteraction("draw");
        setMode("select");
        setSelected({ type: "building", id: saved.id });
        setPlacingAssociatedBuildingId(saved.id);
        const hasActiveEntrance = currentNodes.some((node) =>
          node.nodeType === "Entrance"
          && node.associatedPlaceId === saved.id
          && node.status !== "Inactive",
        );
        setNonRoutableBuildingId(hasActiveEntrance ? null : saved.id);
        void queryClient.invalidateQueries({ queryKey: ["locations"] });
        completeToolDraft("polygon");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to create Building.");
      }
      return;
    }

    completeBuildingWorkflow({
      id: `building-${Date.now()}`,
      name: buildingName.trim(),
      code: buildingCode.trim(),
      points: [],
    }, "create");
  };

  const handleAttachBuilding = () => {
    const existing = buildingAssociationOptions.find((building) => building.id === selectedAttachBuildingId);
    if (!existing) return;
    const eligibility = getBuildingAttachmentEligibility(existing, currentFeatureLinks);
    if (!eligibility.eligible) {
      setError(eligibility.reason);
      return;
    }
    const geometryIssues = validateBuildingFootprintGeometry(points, campusBoundary);
    if (geometryIssues.length > 0) {
      setError(geometryIssues[0].message);
      return;
    }
    completeBuildingWorkflow(existing, "attach");
  };

  const startGuidedEntranceDraft = () => {
    const building = currentBuildings.find((candidate) => candidate.id === nonRoutableBuildingId);
    if (!building) return;
    setPlacingNodeType("Entrance");
    setPlacingNodeName(`${building.name} Entrance`);
    setPlacingAssociatedBuildingId(building.id);
    setTemporary(null);
    setPointDraftDirty(false);
    setMode("place");
  };

  const resetDraft = () => {
    setLocalLocations([]);
    setLocalNodes([]);
    setLocalPathways([]);
    setDeletedPathwayIds([]);
    setLocalBuildings([]);
    setLocalFeatureChanges([]);
    setLocalFeatureLinks([]);
    setUnlinkedFeatureLinkIds([]);
    setLocalFeaturePoints([]);
    setLocalFeatureName("New Parking Area");
    setOwnerModal(null);
    setAddRoomOpen(false);
    setLinkingBuildingEntrance(false);
    setBuildingIndoorFloor(standardFloorLevels[0]);
    setNewRoom({ name: "", code: "", floor: "" });
    setDirty(false);
    setTemporary(null);
    setPointDraftDirty(false);
    setPoints([]);
    setPolygonClosed(false);
    setBuildingWorkflowMode("create");
    setBuildingDetailsModalOpen(false);
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    setNonRoutableBuildingId(null);
    setPathPoints([]);
    setPathwayDraft(null);
    setPathwayDraftOriginal(null);
    setRouteNodeDraft(null);
    setRouteNodeDraftOriginal(null);
    setEditingPathId(null);
    setProvisionalPathwayId(null);
    setPathStartNodeId(null);
    setPathDraftDirty(false);
    setEditingBuildingId(null);
    setConfirm(null);
    setLifecycleConfirmation(null);
    setPreviewOpen(false);
    setError("");
    setMode("select");
    setSelected(null);
    workingSessionManager.reset();
  };

  const updateLocation = (updated: Location) => { setLocalLocations((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updateNode = (updated: RouteNode) => { setLocalNodes((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updatePathway = (updated: Pathway): boolean => {
    const connectionError = pathwayConnectionError(
      updated.sourceNodeId,
      updated.destinationNodeId,
      currentPathways.filter((pathway) => pathway.id !== updated.id),
    );
    if (connectionError) {
      setError(connectionError);
      return false;
    }
    setLocalPathways((items) => [...items.filter((item) => item.id !== updated.id), updated]);
    setDirty(true);
    setError("");
    return true;
  };
  const updateBuilding = (updated: Building) => { setLocalBuildings((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const focusObject = (object: MapObjectReference, fieldLabel?: string) => {
    setPreviewOpen(false);
    setSelected({ type: object.type, id: object.id });
    if (fieldLabel) {
      if (object.type === "building" || object.type === "location") setOwnerModal("location");
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
      resetDraft();
      return;
    }
    try {
      const pathwaysToSave = currentPathways
        .filter((pathway) => localPathways.some((draft) => draft.id === pathway.id) || pathway.id === editingPathId)
        .map((pathway) => ({
          ...pathway,
          pathPoints: withoutEndpointPathPoints(
            pathway.id === editingPathId ? pathPoints : pathway.pathPoints,
            routeNodePoint(currentNodes, pathway.sourceNodeId),
            routeNodePoint(currentNodes, pathway.destinationNodeId),
          ),
        }));
      const operations = workingSessionManager.getUncommittedOperations();
      let gatewayResult: SaveDraftResult | undefined;
      if (services.map.saveDraft) {
        gatewayResult = await services.map.saveDraft({
          projectId: "proj-echague",
          baseDraftVersion: draftVersion,
          requestId: saveRequestId.current,
          operations,
        });
        if (!gatewayResult.success) {
          const detail = gatewayResult.errorType === "CONCURRENCY_CONFLICT"
            ? `Admin Draft changed on the server (version ${gatewayResult.currentServerDraftVersion}). Refresh or rebase your ${workingSessionManager.getUncommittedCount()} pending change${workingSessionManager.getUncommittedCount() === 1 ? "" : "s"}, then retry.`
            : gatewayResult.message;
          setError(detail);
          return;
        }
        setDraftVersion(gatewayResult.newDraftVersion);
      } else {
        await services.map.save({
          selected: selected ?? undefined,
          areaPoints: points.length >= 3 ? points : undefined,
          locations: localLocations,
          nodes: localNodes,
          buildings: localBuildings,
          pathways: pathwaysToSave,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["map"] }),
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
      ]);
      workingSessionManager.markSaved();
      saveRequestId.current = `map-save-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setDirty(false);
      setConfirm(null);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save map changes.",
      );
    }
  };

  const activePathway = currentPathways.find((p) => p.id === editingPathId);

  const startNewPathway = () => {
    setEditingPathId(null);
    setPathwayDraft(null);
    setPathwayDraftOriginal(null);
    setProvisionalPathwayId(null);
    setPathStartNodeId(null);
    setPathPoints([]);
    setSelected(null);
    setPathDraftDirty(false);
    setMode("path");
  };

  const networkSnapshotForImport = (): NetworkSnapshot => ({
    buildings: currentBuildings.map((building) => ({
      id: building.id,
      name: building.name,
      code: building.code,
      geometry: building.points.map(([latitude, longitude]) => ({ latitude, longitude })),
      status: building.status === "Inactive" ? "inactive" : "active",
    })),
    routeNodes: currentNodes.map((node) => ({
      id: node.id, name: node.name, latitude: node.lat, longitude: node.lng,
      status: node.status === "Inactive" ? "inactive" : "active",
      type: node.nodeType === "Entrance" ? "entrance" : node.nodeType === "Access Point" ? "access_point" : "junction",
      buildingId: node.nodeType === "Entrance" ? node.associatedPlaceId ?? null : null,
    } as NetworkSnapshot["routeNodes"][number])),
    pathways: currentPathways.map((pathway) => ({
      id: pathway.id, name: pathway.name, sourceNodeId: pathway.sourceNodeId, destinationNodeId: pathway.destinationNodeId,
      pathSequence: { points: pathway.pathPoints.map(([latitude, longitude]) => ({ latitude, longitude })) },
      distanceMeters: null, estimatedTimeSeconds: null, type: pathway.type, shade: pathway.shade,
      direction: pathway.direction === "One-way" ? "one_way" : pathway.direction === "Two-way" ? "two_way" : null,
      status: pathway.status === "Closed" ? "closed" : "active",
      allowedModes: (pathway.allowedModes ?? ["Walking"]).map((mode) => mode === "Vehicle" ? "vehicle" : "walking"),
    })),
  });

  const beginWalkingNetworkImport = () => {
    importInputRef.current?.click();
  };

  const handleWalkingNetworkFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const preview = previewWalkingNetworkImport(await file.text(), networkSnapshotForImport(), campusBoundary);
    setWalkingNetworkImport(preview);
    setImportAdvisoriesAcknowledged(false);
  };

  const applyWalkingNetworkImport = () => {
    if (!walkingNetworkImport || walkingNetworkImport.findings.some((finding) => finding.severity === "blocking")
      || (walkingNetworkImport.findings.some((finding) => finding.severity === "advisory") && !importAdvisoriesAcknowledged)) return;
    const nodes = walkingNetworkImport.routeNodes.map((node) => ({
      id: node.id, name: node.name, nodeType: node.type === "entrance" ? "Entrance" : node.type === "access_point" ? "Access Point" : "Junction",
      associatedPlaceId: node.buildingId, lat: node.latitude, lng: node.longitude,
    } as RouteNode));
    const pathways = walkingNetworkImport.pathways.map((pathway) => ({
      id: pathway.id, name: pathway.name, sourceNodeId: pathway.sourceNodeId, destinationNodeId: pathway.destinationNodeId,
      pathPoints: pathway.pathSequence.points.map((point) => [point.latitude, point.longitude] as [number, number]),
      distance: "Unknown", time: "Unknown", shade: (pathway.shade ?? "Unknown") as Pathway["shade"], type: pathway.type ?? "Walkway",
      direction: pathway.direction === "one_way" ? "One-way" : "Two-way", status: pathway.status === "closed" ? "Closed" : "Active",
      allowedModes: pathway.allowedModes?.map((mode) => mode === "vehicle" ? "Vehicle" : "Walking"),
    } as Pathway));
    setLocalNodes((items) => [...items, ...nodes]);
    setLocalPathways((items) => [...items, ...pathways]);
    workingSessionManager.executeBatch("Import Walking Network", "Walking Network", "walking-network-import", walkingNetworkImport.operations.map((operation) => ({
      ...operation,
      after: (pathways.find((pathway) => pathway.id === operation.entityId) ?? nodes.find((node) => node.id === operation.entityId)) as unknown as Record<string, unknown>,
    })));
    setDirty(true);
    setWalkingNetworkImport(null);
    setNetworkBrowserOpen(true);
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
      "Walking Network",
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
    type DraftSnapshot = Omit<ActiveToolDraft, "id" | "isSuspended">;
    const snapshotBuilders: Record<ToolType, () => DraftSnapshot | null> = {
      select: () => null,
      point: () => temporary && pointDraftDirty ? ({
        toolType: "point",
        label: "Route Node draft",
        provisionalGeometry: {
          points: [{ x: temporary[1], y: temporary[0], lat: temporary[0], lng: temporary[1] }],
        },
        nestedRecords: {
          editorMode: mode,
          placingNodeType,
          placingNodeName,
          placingAssociatedBuildingId,
          movingId,
          selected,
        },
      }) : null,
      polygon: () => points.length > 0 ? ({
        toolType: "polygon",
        label: "Building Polygon draft",
        provisionalGeometry: {
          points: points.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
          isClosed: polygonClosed,
        },
        nestedRecords: {
          buildingForm,
          buildingName,
          buildingCode,
          buildingFunction,
          buildingKeywords,
          buildingClassification,
          editingBuildingId,
          polygonClosed,
          buildingDetailsModalOpen,
          polygonInteraction,
          buildingWorkflowMode,
          buildingRecordMode: buildingWorkflowMode,
          selectedAttachBuildingId,
          selectedBuildingRecordId: selectedAttachBuildingId,
          attachBuildingSearch,
          buildingRecordSearch: attachBuildingSearch,
        },
      }) : null,
      pathway: () => pathStartNodeId || pathDraftDirty ? ({
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
      }) : null,
      local_feature: () => localFeaturePoints.length > 0 ? ({
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
      }) : null,
    };
    return snapshotBuilders[activeTool]();
  }, [
    activePathway?.destinationNodeId,
    activePathway?.sourceNodeId,
    activeTool,
    buildingForm,
    buildingWorkflowMode,
    attachBuildingSearch,
    editingBuildingId,
    polygonInteraction,
    selectedAttachBuildingId,
    editingPathId,
    localPathways,
    localFeatureName,
    localFeaturePoints,
    manualPathPointDrag,
    mode,
    movingId,
    pathDraftDirty,
    pathPoints,
    polygonClosed,
    buildingDetailsModalOpen,
    pathStartNodeId,
    pointDraftDirty,
    placingAssociatedBuildingId,
    placingNodeName,
    placingNodeType,
    points,
    provisionalPathwayId,
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
    const clearHandlers: Record<Exclude<ToolType, "select">, () => void> = {
      point: () => {
        setTemporary(null);
        setPointDraftDirty(false);
      },
      polygon: () => {
        setPoints([]);
        setPolygonClosed(false);
        setBuildingWorkflowMode("create");
        setBuildingDetailsModalOpen(false);
        setAttachBuildingSearch("");
        setSelectedAttachBuildingId(null);
        resetBuildingForm();
        setEditingBuildingId(null);
      },
      pathway: () => {
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
      },
      local_feature: () => setLocalFeaturePoints([]),
    };
    clearHandlers[toolType]();
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
    if (!canCreateLocalFeature || !geometryOnCampus(localFeaturePoints, campusBoundary)) {
      if (canCreateLocalFeature) setError("New or modified geometry must stay inside the ISU Echague campus boundary.");
      return;
    }
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
    const activationHandlers: Record<ToolType, () => void> = {
      select: () => {
        setMode("select");
        setTemporary(null);
        setPointDraftDirty(false);
      },
      point: () => {
        setMode("place");
        setSelected(null);
        setPlacingNodeType("Entrance");
        setPlacingNodeName("");
        setPlacingAssociatedBuildingId(null);
        setPointDraftDirty(false);
      },
      polygon: () => {
        setMode("area");
        setPolygonInteraction("draw");
        setPolygonClosed(false);
      },
      pathway: () => {
        setMode("path");
        setNetworkBrowserOpen(true);
        if (!editingPathId && (directoryPathways.length || localPathways.length)) {
          const first = localPathways[0] || directoryPathways[0];
          if (first?.status === "Open") {
            setEditingPathId(first.id);
            setPathwayDraft({ ...first });
            setPathwayDraftOriginal({ ...first });
            setPathPoints(first.pathPoints || []);
            setSelected({ type: "pathway", id: first.id });
          }
        }
      },
      local_feature: () => {
        setMode("local_feature");
        setSelected(null);
        setLocalFeaturePoints([]);
      },
    };
    activationHandlers[toolType]();
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

    const restoreHandlers: Record<ActiveToolDraft["toolType"], () => void> = {
      point: () => {
        setTemporary(restoredPoints[0] ?? null);
        setPointDraftDirty(true);
        setMode(records.editorMode === "move" ? "move" : "place");
        if (records.placingNodeType === "Entrance" || records.placingNodeType === "Junction" || records.placingNodeType === "Access Point") setPlacingNodeType(records.placingNodeType);
        if (typeof records.placingNodeName === "string") setPlacingNodeName(records.placingNodeName);
        if (typeof records.placingAssociatedBuildingId === "string" || records.placingAssociatedBuildingId === null) {
          setPlacingAssociatedBuildingId(records.placingAssociatedBuildingId);
        } else if (typeof records.placingAssociatedPlaceId === "string" || records.placingAssociatedPlaceId === null) {
          setPlacingAssociatedBuildingId(records.placingAssociatedPlaceId);
        }
        setMovingId(typeof records.movingId === "string" ? records.movingId : null);
        const restoredSelection = records.selected;
        if (
          restoredSelection
          && typeof restoredSelection === "object"
          && "type" in restoredSelection
          && "id" in restoredSelection
          && restoredSelection.type === "node"
          && typeof restoredSelection.id === "string"
        ) setSelected({ type: restoredSelection.type, id: restoredSelection.id });
        else setSelected(null);
      },
      polygon: () => {
        setPoints(restoredPoints);
        if (records.buildingForm && typeof records.buildingForm === "object") {
          const form = records.buildingForm as Record<string, unknown>;
          setBuildingForm({
            name: typeof form.name === "string" ? form.name : "",
            code: typeof form.code === "string" ? form.code : "",
            function: typeof form.function === "string" ? form.function : "",
            keywords: typeof form.keywords === "string" ? form.keywords : "",
            status: "Active",
          });
        } else {
          setBuildingForm({
            name: typeof records.buildingName === "string" ? records.buildingName : "",
            code: typeof records.buildingCode === "string" ? records.buildingCode : "",
            function: typeof records.buildingFunction === "string" ? records.buildingFunction : "",
            keywords: typeof records.buildingKeywords === "string" ? records.buildingKeywords : "",
            status: "Active",
          });
        }
        setBuildingClassification(records.buildingClassification === "Facility" ? "Facility" : "Building");
        setEditingBuildingId(typeof records.editingBuildingId === "string" ? records.editingBuildingId : null);
        setPolygonClosed(records.polygonClosed === true);
        setBuildingDetailsModalOpen(records.buildingDetailsModalOpen === true);
        if (records.polygonInteraction === "draw" || records.polygonInteraction === "reshape" || records.polygonInteraction === "move") {
          setPolygonInteraction(records.polygonInteraction);
        } else {
          setPolygonInteraction("draw");
        }
        const restoredWorkflowMode = records.buildingWorkflowMode ?? records.buildingRecordMode;
        if (restoredWorkflowMode === "create" || restoredWorkflowMode === "attach") {
          setBuildingWorkflowMode(restoredWorkflowMode);
        }
        const restoredSelectedId = typeof records.selectedAttachBuildingId === "string"
          ? records.selectedAttachBuildingId
          : typeof records.selectedBuildingRecordId === "string"
            ? records.selectedBuildingRecordId
            : null;
        setSelectedAttachBuildingId(restoredSelectedId);
        const restoredSearch = typeof records.attachBuildingSearch === "string"
          ? records.attachBuildingSearch
          : typeof records.buildingRecordSearch === "string"
            ? records.buildingRecordSearch
            : "";
        setAttachBuildingSearch(restoredSearch);
        setMode("area");
      },
      pathway: () => {
        setPathPoints(restoredPoints);
        setPathStartNodeId(draft.provisionalGeometry.startNodeId ?? null);
        setEditingPathId(typeof records.editingPathId === "string" ? records.editingPathId : null);
        setSelectedPathPointIndex(typeof records.selectedPathPointIndex === "number" ? records.selectedPathPointIndex : null);
        setManualPathPointDrag(records.manualPathPointDrag === true);
        const restoredProvisionalPathway = isPathwayDraft(records.provisionalPathway)
          ? { ...records.provisionalPathway, pathPoints: restoredPoints }
          : null;
        setProvisionalPathwayId(typeof records.provisionalPathwayId === "string" ? records.provisionalPathwayId : null);
        if (restoredProvisionalPathway) {
          setLocalPathways((pathways) => [
            ...pathways.filter((pathway) => pathway.id !== restoredProvisionalPathway.id),
            restoredProvisionalPathway,
          ]);
        }
        setPathDraftDirty(true);
        setMode("path");
      },
      local_feature: () => {
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
      },
    };
    restoreHandlers[draft.toolType]();
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
  const updateNodeWithOperation = (before: RouteNode, after: RouteNode, description: string) => {
    updateNode(after);
    recordPropertyOperation("Walking Network", before.id, before, after, description);
  };
  const routeNodeFrame = selectedNode && routeNodeDraft?.id === selectedNode.id ? routeNodeDraft : selectedNode;
  const routeNodeFrameDirty = Boolean(routeNodeDraft && routeNodeDraftOriginal
    && JSON.stringify(routeNodeDraft) !== JSON.stringify(routeNodeDraftOriginal));
  const applyRouteNodeFrame = () => {
    if (!routeNodeDraft || !routeNodeDraftOriginal || !routeNodeFrameDirty) return;
    const issues = validateRouteNodeDraft(routeNodeDraft, { buildings: currentBuildings, locations: currentLocations, campusBoundary });
    if (issues.length) {
      setError(issues[0].message);
      window.setTimeout(() => document.querySelector<HTMLElement>(`[aria-label="${issues[0].field === "name" ? "Route Node name" : issues[0].field === "nodeType" ? "Route Node type" : issues[0].field === "association" ? "Route Node association" : "Route Node latitude"}"]`)?.focus());
      return;
    }
    updateNodeWithOperation(routeNodeDraftOriginal, routeNodeDraft, `Edit ${routeNodeDraft.name}`);
    setRouteNodeDraftOriginal({ ...routeNodeDraft });
    setError("");
  };
  const cancelRouteNodeFrame = () => {
    if (!routeNodeDraftOriginal) return;
    setRouteNodeDraft({ ...routeNodeDraftOriginal });
    setError("");
  };

  const confirmLifecycleAction = () => {
    if (!lifecycleConfirmation) return;
    const { action, impact } = lifecycleConfirmation;
    const change = buildLifecycleChange(action, impact.object);
    if (action === "close_pathway" || action === "reopen_pathway") {
      const updatedPathway = change.record as Pathway;
      if (!updatePathway(updatedPathway)) return;
      // The inspector keeps an editable frame over the collection. Update the
      // frame as well so it cannot mask the confirmed lifecycle status.
      if (pathwayDraft?.id === updatedPathway.id) {
        setPathwayDraft({ ...updatedPathway });
        setPathwayDraftOriginal({ ...updatedPathway });
        setPathDraftDirty(false);
      }
      // Lifecycle changes return to browse mode. This keeps the single
      // pathway card authoritative after an Active/Closed decision and
      // prevents a stale reshape surface from masking the new status.
      setEditingPathId(null);
      setPathPoints([]);
      setManualPathPointDrag(false);
      setMode("select");
    } else {
      updateNode(change.record as RouteNode);
    }
    workingSessionManager.executeOperation(change.operation);
    setDirty(true);
    setLifecycleConfirmation(null);
    setError("");
  };

  const locationModalEntity: Location | null = selectedLocation ?? (selectedBuilding ? {
    id: selectedBuildingLocation?.id ?? selectedBuilding.id,
    name: selectedBuilding.name,
    code: selectedBuilding.code,
    type: selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building",
    parentId: null,
    function: selectedBuildingLocation?.function ?? "Campus Building",
    keywords: selectedBuildingLocation?.keywords ?? "",
    status: selectedBuildingLocation?.status ?? selectedBuilding.status ?? "Active",
    lat: selectedBuildingLocation?.lat ?? null,
    lng: selectedBuildingLocation?.lng ?? null,
    positioned: true,
  } : null);

  const initializeBuildingFootprintEdit = (
    building: Building,
    interaction: "draw" | "reshape" | "move" = "draw",
  ) => {
    setEditingBuildingId(building.id);
    setBuildingForm({
      name: building.name,
      code: building.code,
      function: "",
      keywords: "",
      status: building.status ?? "Active",
    });
    setPoints([...building.points]);
    setPolygonInteraction(interaction);
    setPolygonClosed(true);
    setMode("area");
  };

  const pathwayFrame = selectedPath && pathwayDraft?.id === selectedPath.id
    ? { ...pathwayDraft, pathPoints: editingPathId === selectedPath.id ? pathPoints : pathwayDraft.pathPoints }
    : selectedPath ?? activePathway;
  const pathwayFrameIssues = pathwayFrame
    ? validatePathwayDraft(pathwayFrame, currentNodes, campusBoundary, {
      existingPathways: currentPathways.filter((pathway) => pathway.id !== pathwayFrame.id),
      requireActiveEndpoints: true,
    })
    : [];
  const pathwayFrameDirty = Boolean(
    pathwayFrame && (
      (pathwayDraftOriginal && JSON.stringify(pathwayFrame) !== JSON.stringify(pathwayDraftOriginal))
      || (!pathwayDraftOriginal && provisionalPathwayId === pathwayFrame.id)
    ),
  );
  const applyPathwayFrame = () => {
    if (!pathwayFrame || pathwayFrameIssues.length > 0) {
      if (pathwayFrameIssues[0]) setError(pathwayFrameIssues[0].message);
      return;
    }
    if (!pathwayFrameDirty) return;
    if (!pathwayDraftOriginal && provisionalPathwayId === pathwayFrame.id) {
      handleSavePathShape();
      return;
    }
    const before = pathwayDraftOriginal!;
    const after = pathwayFrame;
    const operations: WorkingOperation[] = [];
    if (JSON.stringify({ ...before, pathPoints: undefined }) !== JSON.stringify({ ...after, pathPoints: undefined })) {
      operations.push({
        id: `pathway-properties-${after.id}`,
        type: "update_properties",
        domain: "Walking Network",
        entityId: after.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        description: `Edit ${after.name}`,
      });
    }
    if (JSON.stringify(before.pathPoints) !== JSON.stringify(after.pathPoints)) {
      operations.push({
        id: `pathway-geometry-${after.id}`,
        type: "update_geometry",
        domain: "Walking Network",
        entityId: after.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        description: `Reshape ${after.name}`,
      });
    }
    if (operations.length > 1) workingSessionManager.executeBatch(`Edit ${after.name}`, "Walking Network", after.id, operations);
    else if (operations[0]) workingSessionManager.executeOperation(operations[0]);
    setLocalPathways((items) => [...items.filter((item) => item.id !== after.id), after]);
    setPathwayDraftOriginal({ ...after });
    setPathwayDraft({ ...after });
    setPathPoints([...after.pathPoints]);
    setPathDraftDirty(false);
    setDirty(true);
    setError("");
  };
  const cancelPathwayFrame = () => {
    if (!pathwayDraftOriginal) {
      if (provisionalPathwayId) setLocalPathways((items) => items.filter((item) => item.id !== provisionalPathwayId));
      setPathwayDraft(null);
      setPathwayDraftOriginal(null);
      setProvisionalPathwayId(null);
      setEditingPathId(null);
      setPathPoints([]);
      setSelected(null);
      setMode("select");
      completeToolDraft("pathway");
      return;
    }
    setPathwayDraft({ ...pathwayDraftOriginal });
    setPathPoints([...pathwayDraftOriginal.pathPoints]);
    setPathDraftDirty(false);
    setSelectedPathPointIndex(null);
    setSelected({ type: "pathway", id: pathwayDraftOriginal.id });
    setError("");
  };

  const startSelectedBuildingGeometryEdit = () => {
    if (!selectedBuilding) return;
    initializeBuildingFootprintEdit(selectedBuilding, "reshape");
  };

  const startSelectedBuildingMove = () => {
    if (!selectedBuilding) return;
    initializeBuildingFootprintEdit(selectedBuilding, "move");
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
            <section aria-label="Building summary" className="inspector-related-section">
              <h3>Building summary</h3>
              <p>{selectedBuilding.code} · {(selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building")}</p>
              <p>{selectedBuildingHasFootprint ? "Linked Building Footprint" : "Footprint not linked"} · {selectedBuildingRoutable ? "Routable" : "Not routable"}</p>
            </section>
            <section aria-label="Building content" className="inspector-related-section">
              <h3>Building content</h3>
              <label className="inspector-point-selector">Floor Level for new Indoor Location
                <select aria-label="Floor Level for new Indoor Location" value={buildingIndoorFloor} onChange={(event) => setBuildingIndoorFloor(event.target.value)}>
                  {standardFloorLevels.map((floor) => <option key={floor}>{floor}</option>)}
                </select>
              </label>
              {(selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building") === "Building" && <button type="button" className="inspector-secondary-action" onClick={() => openIndoorLocationHandoff(selectedBuilding, buildingIndoorFloor)}>＋ Add indoor location</button>}
              <section aria-label="Building room directory">
                <h4>Indoor Locations by Floor Level</h4>
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
            </section>
            <section aria-label="Walking access" className="inspector-related-section">
              <h3>Walking access</h3>
              <section aria-label="Building entrances">
                <h4>Entrance Route Nodes</h4>
                {selectedBuildingEntrances.length
                  ? selectedBuildingEntrances.map((node) => <span key={node.id}>{node.name}</span>)
                  : <p>No active Entrance Route Node.</p>}
              </section>
              <div className="inspector-inline-actions">
                <button type="button" onClick={() => { setPlacingNodeType("Entrance"); setPlacingNodeName(`${selectedBuilding.name} Entrance`); setPlacingAssociatedBuildingId(selectedBuildingAssociationId ?? selectedBuilding.id); setTemporary(null); setMode("place"); }}>＋ Add entrance</button>
                <button type="button" onClick={() => setLinkingBuildingEntrance((open) => !open)}>↔ Link existing entrance</button>
              </div>
              {linkingBuildingEntrance && (
                <div className="inspector-related-group" aria-label="Existing Entrance Route Nodes">
                  <strong>Select an existing Entrance Route Node</strong>
                  {currentNodes.filter((node) => node.nodeType === "Entrance").map((node) => <button key={node.id} type="button" onClick={() => linkExistingEntrance(selectedBuilding, node)}>Link {node.name}</button>)}
                  {!currentNodes.some((node) => node.nodeType === "Entrance") && <span>No Entrance Route Nodes available.</span>}
                </div>
              )}
            </section>
          </>
        ),
        primaryAction: {
          label: "▱ Reshape Footprint",
          onSelect: startSelectedBuildingGeometryEdit,
        },
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("location") },
          ...((selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building") === "Building" ? [{ label: "＋ Add indoor location", onSelect: () => openIndoorLocationHandoff(selectedBuilding, buildingIndoorFloor) }] : []),
          { label: "＋ Add entrance", onSelect: () => { setPlacingNodeType("Entrance"); setPlacingNodeName(`${selectedBuilding.name} Entrance`); setPlacingAssociatedBuildingId(selectedBuildingAssociationId ?? selectedBuilding.id); setTemporary(null); setMode("place"); } },
          { label: "↔ Link existing entrance", onSelect: () => setLinkingBuildingEntrance(true) },
          {
            label: "🗑 Retire Footprint",
            tone: "danger" as const,
            onSelect: () => {
              const footprintLink = currentFeatureLinks.find((link) =>
                link.targetDomain === "Locations"
                && link.targetEntityId === selectedBuilding.id
                && link.linkType === "building_footprint",
              );
              const footprint = currentLocalFeatures.find((feature) =>
                feature.id === footprintLink?.featureId
                || (feature.family === "building_footprint"
                  && (feature.linkedBuildingId === selectedBuilding.id || feature.id === `feat-poly-${selectedBuilding.id}`)),
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
      const isFootprintOwner = selectedLocation.type === "Building" || selectedLocation.type === "Facility";
      return {
        id: selectedLocation.id,
        kind: isFootprintOwner ? "building" : "campus_location",
        title: selectedLocation.name,
        domain: "Locations",
        status: isFootprintOwner
          ? "Campus Location · footprint geometry managed in Map Editor"
          : "Campus Location",
        summary: [
          { label: "Code", value: selectedLocation.code },
          { label: "Type", value: selectedLocation.type },
          { label: "Spatial source", value: isFootprintOwner ? "Linked Building Footprint" : "Inherited from parent Building" },
        ],
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("location") },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedNode) {
      const stageRouteNodeEdit = (updated: RouteNode) => {
        setRouteNodeDraft(updated);
      };
      const connectedPathways = currentPathways.filter((pathway) => pathway.sourceNodeId === selectedNode.id || pathway.destinationNodeId === selectedNode.id);
      const connectedPaths = connectedPathways.length;
      const nodeFindings = validateRouteNodeDraft(selectedNode, {
        buildings: currentBuildings,
        locations: currentLocations,
        campusBoundary,
      });
      const associatedBuilding = selectedNode.associatedPlaceId
        ? currentBuildings.find((building) => building.id === selectedNode.associatedPlaceId)
          ?? currentLocations.find((location) => location.id === selectedNode.associatedPlaceId && (location.type === "Building" || location.type === "Facility"))
        : null;
      return {
        id: selectedNode.id,
        kind: selectedNode.nodeType === "Entrance" ? "entrance_route_node" : "route_node",
        title: selectedNode.name,
        domain: "Walking Network",
        status: selectedNode.nodeType === "Entrance" ? "Entrance Route Node" : `${selectedNode.nodeType} Route Node`,
        summary: [
          { label: "Node Type", value: selectedNode.nodeType },
          { label: "Lifecycle", value: selectedNode.status ?? "Active" },
          { label: "Associated Building", value: associatedBuilding?.name ?? (selectedNode.associatedPlaceId ? "Missing" : "None") },
          { label: "Connected Pathways", value: String(connectedPaths) },
          { label: "Network Findings", value: nodeFindings.length ? nodeFindings[0].message : "No blocking findings" },
          { label: "Latitude", value: selectedNode.lat.toFixed(6) },
          { label: "Longitude", value: selectedNode.lng.toFixed(6) },
        ],
        details: (
          <section className="inspector-related-section" aria-label="Edit Route Node metadata">
            <h3>Route Node metadata</h3>
            <div className="inspector-edit-fields">
              <label> Name
                <input aria-label="Route Node name" value={routeNodeFrame?.name ?? selectedNode.name} onChange={(event) => {
                  const name = event.target.value;
                  stageRouteNodeEdit({ ...(routeNodeFrame ?? selectedNode), name });
                }} />
              </label>
              <label> Node type
                <select aria-label="Route Node type" value={routeNodeFrame?.nodeType ?? selectedNode.nodeType} onChange={(event) => {
                  const nodeType = event.target.value as RouteNode["nodeType"];
                  stageRouteNodeEdit({ ...(routeNodeFrame ?? selectedNode), nodeType, associatedPlaceId: nodeType === "Entrance" ? routeNodeFrame?.associatedPlaceId ?? null : null });
                }}>
                  <option>Entrance</option><option>Junction</option><option>Access Point</option>
                </select>
              </label>
              {(routeNodeFrame?.nodeType ?? selectedNode.nodeType) === "Entrance" && (
                <label> Building association
                  <select aria-label="Route Node association" value={routeNodeFrame?.associatedPlaceId ?? ""} onChange={(event) => {
                    const associatedPlaceId = event.target.value || null;
                    stageRouteNodeEdit({ ...(routeNodeFrame ?? selectedNode), associatedPlaceId });
                  }}>
                    <option value="">No Building association</option>
                    {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
                  </select>
                  <span className="mt-1 block text-[10px] text-[#526359]">Building choices are preview-only; this association is not persisted yet.</span>
                </label>
              )}
            </div>
            <div className="inspector-inline-actions">
              <button type="button" onClick={cancelRouteNodeFrame} disabled={!routeNodeFrameDirty}>Cancel</button>
              <button type="button" onClick={applyRouteNodeFrame} disabled={!routeNodeFrameDirty}>Apply changes</button>
            </div>
          </section>
        ),
        primaryAction: { label: selectedNode.nodeType === "Entrance" ? "✥ Move Entrance" : "✥ Move Route Node", onSelect: handleStartMoveNode },
        overflowActions: [
          ...(selectedNode.nodeType === "Entrance" ? [{
            label: "⎋ Convert to Standard Node",
            tone: "danger" as const,
            onSelect: () => {
              const updated = { ...selectedNode, nodeType: "Junction" as const, associatedPlaceId: null };
              updateNode(updated);
              recordPropertyOperation("Walking Network", selectedNode.id, selectedNode, updated, `Convert ${selectedNode.name} to a standard Route Node`);
            },
          }] : []),
          {
            label: selectedNode.status === "Inactive" ? "↻ Reactivate Route Node" : "⏸ Deactivate Route Node",
            tone: "danger" as const,
            onSelect: () => {
              const action: LifecycleAction = selectedNode.status === "Inactive" ? "reactivate_node" : "deactivate_node";
              setLifecycleConfirmation({ action, impact: calculateLifecycleImpact({ action, object: selectedNode, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
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
        domain: "Walking Network",
        status: `${selectedPath.direction} · ${selectedPath.status}${pathwayFrameDirty ? " · Unsaved draft" : ""}`,
        summary: [
          { label: "Source Route Node", value: currentNodes.find((node) => node.id === selectedPath.sourceNodeId)?.name ?? selectedPath.sourceNodeId },
          { label: "Destination Route Node", value: currentNodes.find((node) => node.id === selectedPath.destinationNodeId)?.name ?? selectedPath.destinationNodeId },
          { label: "Path Sequence", value: `${selectedPath.pathPoints.length} intermediate point${selectedPath.pathPoints.length === 1 ? "" : "s"}` },
          { label: "Distance", value: selectedPath.distance },
        ],
        details: (
          <>
            <section className="inspector-related-section" aria-label="Pathway metadata">
              <h3>Pathway metadata</h3>
              <div className="inspector-edit-fields">
                <label>Pathway name<input aria-label="Pathway name" placeholder="e.g. Science Walk" value={pathwayFrame?.name ?? selectedPath.name} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
                <label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label>
                <label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label>
                <label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
                <label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? "Active"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}>{pathwayFrame?.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></select></label>
              </div>
              <fieldset className="mt-2 rounded-xl border border-[#dbe0e2] p-2.5"><legend className="px-1 text-xs font-semibold text-[#3f4941]">Allowed modes</legend><div className="grid grid-cols-2 gap-2 text-xs">{["Walking", "Vehicle"].map((mode) => { const allowedModes = pathwayFrame?.allowedModes ?? ["Walking"]; const vehicleBlocked = pathwayFrame?.type === "Walkway" && mode === "Vehicle"; return <label key={mode} className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={vehicleBlocked} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>; })}</div></fieldset>
            </section>
            <section className="inspector-related-section" aria-label="Path Sequence editor">
              <h3>Path Sequence</h3>
              <label className="inspector-point-selector">Select Path Point
                <select aria-label="Select Path Point" value={selectedPathPointIndex ?? ""} onChange={(event) => { const index = Number(event.target.value); setSelectedPathPointIndex(index); setSelected({ type: "path_point", id: `${selectedPath.id}:point:${index}` }); }}>
                  <option value="" disabled>Choose an ordered point</option>
                  {selectedPath.pathPoints.map((point, index) => <option key={`${index}-${point.join(",")}`} value={index}>Path Point #{index + 1} · {point[0].toFixed(6)}, {point[1].toFixed(6)}</option>)}
                </select>
              </label>
              {selectedPath.pathPoints.length === 0 && <p>No intermediate Path Points.</p>}
              {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
              <h3 className="inspector-subheading">Network findings</h3>
              <p>{pathwayFrameIssues.length ? `${pathwayFrameIssues.length} local finding${pathwayFrameIssues.length === 1 ? "" : "s"} require attention.` : "No locally known blocking findings."}</p>
              <button type="button" className="inspector-secondary-action" onClick={() => { setEditingPathId(selectedPath.id); setPathPoints(selectedPath.pathPoints); setMode("path"); }}>⌁ Reshape Pathway</button>
              <div className="inspector-inline-actions"><button type="button" onClick={cancelPathwayFrame} disabled={!pathwayFrameDirty}>Cancel</button></div>
            </section>
          </>
        ),
        primaryAction: {
          label: "Apply changes",
          disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0,
          disabledReason: pathwayFrameIssues[0]?.message,
          onSelect: applyPathwayFrame,
        },
        overflowActions: [
          { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: cancelPathwayFrame },
          { label: "⌁ Reshape Pathway", onSelect: () => { setEditingPathId(selectedPath.id); setPathPoints(selectedPath.pathPoints); setMode("path"); } },
          {
            label: selectedPath.status === "Closed" ? "↻ Reopen Pathway" : "⏸ Close Pathway",
            tone: "danger" as const,
            onSelect: () => {
              const action: LifecycleAction = selectedPath.status === "Closed" ? "reopen_pathway" : "close_pathway";
              setLifecycleConfirmation({ action, impact: calculateLifecycleImpact({ action, object: selectedPath, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
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
        domain: "Walking Network",
        status: `Nested geometry · ${selectedPathPointIndex + 1} of ${pathPoints.length}`,
        summary: [
          { label: "Source Route Node", value: currentNodes.find((node) => node.id === activePathway?.sourceNodeId)?.name ?? activePathway?.sourceNodeId ?? "—" },
          { label: "Destination Route Node", value: currentNodes.find((node) => node.id === activePathway?.destinationNodeId)?.name ?? activePathway?.destinationNodeId ?? "—" },
          { label: "Path Sequence", value: `${pathPoints.length} intermediate point${pathPoints.length === 1 ? "" : "s"}` },
          { label: "Latitude", value: point[0].toFixed(6) },
          { label: "Longitude", value: point[1].toFixed(6) },
        ],
        details: (
          <>
            <section className="inspector-related-section" aria-label="Parent Pathway context"><h3>Parent Pathway</h3><p>{activePathway?.name ?? editingPathId}</p><p>{activePathway?.shade} · {activePathway?.type} · {activePathway?.direction} · {activePathway?.status}</p></section>
            <label className="inspector-point-selector">Select Path Point
              <select aria-label="Select Path Point" value={selectedPathPointIndex} onChange={(event) => { const index = Number(event.target.value); setSelectedPathPointIndex(index); setSelected({ type: "path_point", id: `${editingPathId}:point:${index}` }); }}>
                {pathPoints.map((candidate, index) => <option key={`${index}-${candidate.join(",")}`} value={index}>Path Point #{index + 1} · {candidate[0].toFixed(6)}, {candidate[1].toFixed(6)}</option>)}
              </select>
            </label>
            <div className="inspector-point-inputs"><label>Latitude
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
            </label></div>
            {pathwayFrameIssues.length > 0 && <div className="inspector-validation" role="alert"><strong>Apply blocked</strong><span>{pathwayFrameIssues[0].message}</span></div>}
            <section className="inspector-related-section" aria-label="Parent Pathway metadata"><h3>Parent Pathway metadata</h3><div className="inspector-edit-fields"><label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? activePathway?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label><label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? activePathway?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label><label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? activePathway?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label><label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? activePathway?.status ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}><option>Open</option><option>Closed</option><option>Unknown</option></select></label></div></section>
            <div className="inspector-inline-actions"><button type="button" onClick={cancelPathwayFrame} disabled={!pathwayFrameDirty}>Cancel</button></div>
          </>
        ),
        primaryAction: {
          label: manualPathPointDrag ? "Stop Dragging" : "✥ Drag Path Point",
          onSelect: () => setManualPathPointDrag((enabled) => !enabled),
        },
        overflowActions: [
          { label: manualPathPointDrag ? "Stop Dragging" : "✥ Drag Path Point", onSelect: () => setManualPathPointDrag((enabled) => !enabled) },
          { label: "✓ Save Pathway", onSelect: applyPathwayFrame },
          { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: cancelPathwayFrame },
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
            disabled={!dirty}
            onClick={() => setConfirm("discard")}
            className="px-4 py-2 border border-[#dbe0e2] rounded-full text-xs font-bold text-[#3f4941] hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={openSaveReview}
            className="px-5 py-2 bg-[#005931] hover:bg-[#004727] rounded-full text-xs font-bold text-white shadow disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Save Changes</span>
          </button>
        </div>
      </div>

      <div className="relative flex-1 rounded-[28px] overflow-hidden border border-[#e1e3e4] shadow-sm bg-[#dce8e2] min-h-[500px]">
        <MapContainer
          center={campusCenter}
          zoom={18}
          minZoom={15}
          maxZoom={22}
          maxBounds={navigationBounds}
          maxBoundsViscosity={0.7}
          zoomControl={false}
          className="w-full h-full"
        >
          <TileLayer
            maxNativeZoom={19}
            maxZoom={22}
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
            frameBounds={frameBounds}
            navigationBounds={navigationBounds}
            onViewportChange={handleViewportChange}
          />

          {filteredBuildings.map((building) => {
            const isSelected = selected?.id === building.id;
            const footprintLink = currentFeatureLinks.find((link) =>
              link.targetDomain === "Locations"
              && link.targetEntityId === building.id
              && link.linkType === "building_footprint",
            );
            const footprint = currentLocalFeatures.find((feature) =>
              feature.id === footprintLink?.featureId
              || (feature.family === "building_footprint"
                && (feature.linkedBuildingId === building.id || feature.id === `feat-poly-${building.id}`)),
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
                  click: (event) => {
                    if (footprintRetired && footprint) selectObject("local_feature", footprint.id);
                    else selectCanvasObject("building", building.id, event.latlng
                      ? [event.latlng.lat, event.latlng.lng]
                      : polygonCentroid(building.points));
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
                  eventHandlers={{ click: () => selectCanvasObject("building", building.id, polygonCentroid(building.points)) }}
                />
              )}
              </Fragment>
            );
          })}

          {filteredPathways.map((path) => {
            const source = currentNodes.find((node) => node.id === path.sourceNodeId);
            const destination = currentNodes.find((node) => node.id === path.destinationNodeId);
            const isEditingThisPath = editingPathId === path.id && mode === "path";
            const currentPoints = isEditingThisPath
              ? pathPointDragPreview
                ? pathPoints.map((point, index) =>
                    index === pathPointDragPreview.index ? pathPointDragPreview.point : point,
                  )
                : pathPoints
              : path.pathPoints;
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
                  click: (event) => {
                    selectCanvasObject("pathway", path.id, event.latlng
                      ? [event.latlng.lat, event.latlng.lng]
                      : [source.lat, source.lng]);
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
            const isSelected = selected?.type === "location" && selected?.id === loc.id;
            return (
              <Marker
                key={loc.id}
                position={[loc.lat, loc.lng]}
                icon={createLocationPinIcon(isSelected)}
                eventHandlers={{
                  click: () => {
                    selectCanvasObject("location", loc.id, [loc.lat, loc.lng]);
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
            if (mode === "move" && movingId === node.id) return null;
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
                      const source = currentNodes.find((candidate) => candidate.id === pathStartNodeId);
                      if (!source || (source.status !== undefined && source.status !== "Active")) {
                        setError("Pathways can only use active Route Nodes.");
                        return;
                      }
                      const connectionError = pathwayConnectionError(pathStartNodeId, node.id, currentPathways);
                      if (connectionError) {
                        setError(connectionError);
                        return;
                      }
                      const newPath: Pathway = {
                        id: `pathway-${Date.now()}`,
                        name: "",
                        sourceNodeId: source.id,
                        destinationNodeId: node.id,
                        distance: "Unknown",
                        time: "Unknown",
                        shade: "Unknown",
                        type: "Walkway",
                        direction: "Two-way",
                        status: "Active",
                        allowedModes: ["Walking"],
                        pathPoints: [],
                      };
                      setLocalPathways((current) => [...current, newPath]);
                      setEditingPathId(newPath.id);
                      setProvisionalPathwayId(newPath.id);
                      setPathPoints([]);
                      setPathwayDraft({ ...newPath });
                      setPathwayDraftOriginal(null);
                      setSelected({ type: "pathway", id: newPath.id });
                      setPathDraftDirty(true);
                      setError("");
                      return;
                    }
                    selectCanvasObject("node", node.id, [node.lat, node.lng]);
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
                draggable={(manualPathPointDrag || activePathway?.status !== "Open") && selectedPathPointIndex === index}
                eventHandlers={{
                  click: () => {
                    setSelectedPathPointIndex(index);
                    setSelected({ type: "path_point", id: `${editingPathId ?? "pathway"}:point:${index}` });
                  },
                  drag: (event) => {
                    const marker = event.target as L.Marker;
                    const next = marker.getLatLng();
                    setPathPointDragPreview({ index, point: [next.lat, next.lng] });
                    setSelectedPathPointIndex(index);
                  },
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    const next = marker.getLatLng();
                    setPathPointDragPreview(null);
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
                  icon={createSplitIcon()}
                  eventHandlers={{ click: () => insertPathPoint(segmentIndex) }}
                />
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
            <Marker
              position={temporary}
              icon={createTempIcon()}
              draggable={mode === "place"}
              eventHandlers={{
                drag: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  setTemporary([next.lat, next.lng]);
                  setPointDraftDirty(true);
                },
                dragend: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  const point: MapPoint = [next.lat, next.lng];
                  if (pointOnCampus(point, campusBoundary)) {
                    setTemporary(point);
                  } else {
                    setError("The new position must stay inside the ISU Echague campus boundary.");
                  }
                },
              }}
            />
          )}
        </MapContainer>

        {networkBrowserOpen && (
          <NetworkBrowser
            pathways={currentPathways}
            nodes={currentNodes}
            buildings={allSessionBuildings}
            selected={networkBrowserSelection}
            onSelect={handleNetworkBrowserSelection}
            onDismiss={() => setNetworkBrowserOpen(false)}
            onImportWalkingNetwork={beginWalkingNetworkImport}
          />
        )}

        {walkingNetworkImport && (
          <div className="absolute inset-0 z-[1200] grid place-items-center bg-[#14231b]/35 p-4" role="dialog" aria-modal="true" aria-label="Walking Network import preview">
            <section className="max-h-[min(720px,calc(100%-2rem))] w-full max-w-xl overflow-y-auto rounded-3xl border border-[#dbe0e2] bg-white p-6 shadow-2xl">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#005931]">Walking Network import</p>
              <h2 className="mt-1 text-xl font-extrabold text-[#191c1d]">Preview proposed changes</h2>
              <p className="mt-2 text-sm text-[#526158]">{walkingNetworkImport.routeNodes.length} Route Nodes and {walkingNetworkImport.pathways.length} Pathways are ready for the Working Session.</p>
              <div className="mt-4 rounded-xl border border-[#dbe0e2] bg-[#f8f9fa] p-3 text-xs">
                <strong>Affected objects</strong>
                <p className="mt-1 break-words text-[#526158]">{walkingNetworkImport.affectedEntityIds.join(", ") || "None"}</p>
              </div>
              {walkingNetworkImport.findings.length > 0 && <div className="mt-3 space-y-2" aria-label="Import findings">
                {walkingNetworkImport.findings.map((finding, index) => <div key={`${finding.row}-${finding.entityId ?? "row"}-${index}`} className={`rounded-xl border p-3 text-xs ${finding.severity === "blocking" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}><strong>{finding.severity === "blocking" ? "Blocking" : "Advisory"} · Row {finding.row}</strong><p className="mt-1">{finding.message}{finding.entityId ? ` (${finding.entityId})` : ""}</p></div>)}
              </div>}
              {walkingNetworkImport.findings.some((finding) => finding.severity === "advisory") && !walkingNetworkImport.findings.some((finding) => finding.severity === "blocking") && <label className="mt-4 flex items-start gap-2 text-xs font-semibold text-[#3f4941]"><input type="checkbox" checked={importAdvisoriesAcknowledged} onChange={(event) => setImportAdvisoriesAcknowledged(event.target.checked)} /> I reviewed the advisory findings and acknowledge importing these objects.</label>}
              <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setWalkingNetworkImport(null)} className="rounded-full border border-[#dbe0e2] px-4 py-2 text-xs font-bold text-[#3f4941]">Cancel</button><button type="button" disabled={walkingNetworkImport.operations.length === 0 || walkingNetworkImport.findings.some((finding) => finding.severity === "blocking") || (walkingNetworkImport.findings.some((finding) => finding.severity === "advisory") && !importAdvisoriesAcknowledged)} onClick={applyWalkingNetworkImport} className="rounded-full bg-[#005931] px-5 py-2 text-xs font-bold text-white disabled:opacity-40">Apply import</button></div>
            </section>
          </div>
        )}

        {selectionPopover && (
          <div
            role="dialog"
            aria-label="Choose overlapping feature"
            data-anchor={selectionPopover.anchor.join(",")}
            className="absolute z-[1100] w-64 -translate-x-1/2 -translate-y-full rounded-2xl border border-[#dbe0e2] bg-white p-3 shadow-xl"
            style={{
              left: `${Math.max(8, Math.min(92, ((selectionPopover.anchor[1] - navigationBounds[0][1]) / (navigationBounds[1][1] - navigationBounds[0][1])) * 100))}%`,
              top: `${Math.max(8, Math.min(92, (1 - (selectionPopover.anchor[0] - navigationBounds[0][0]) / (navigationBounds[1][0] - navigationBounds[0][0])) * 100))}%`,
            }}
          >
            <p className="mb-2 text-xs font-bold text-[#191c1d]">Choose a feature</p>
            <div className="flex flex-col gap-1">
              {selectionPopover.candidates.map((candidate) => (
                <button
                  key={`${candidate.type}-${candidate.id}`}
                  type="button"
                  aria-label={`Select ${candidate.label} ${candidate.kindLabel}`}
                  className="rounded-xl px-3 py-2 text-left text-xs hover:bg-[#edf3ef]"
                  onClick={() => selectObject(candidate.type, candidate.id)}
                >
                  <strong className="block">{candidate.label}</strong>
                  <span className="text-[#59645e]">{candidate.kindLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {outsideBoundaryCount > 0 && (
          <div className="absolute bottom-4 right-4 z-[900] max-w-xs rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-xs text-amber-900 shadow-lg" role="status">
            <strong>{outsideBoundaryCount} existing editable campus feature{outsideBoundaryCount === 1 ? "" : "s"} outside campus boundary.</strong>
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
        />
        <input ref={importInputRef} type="file" accept="application/json,.json" onChange={handleWalkingNetworkFile} className="hidden" aria-label="Import Walking Network file" />

        {pendingToolRequest && workingSessionState.activeDraft && (
          <ToolInterruptionDialog
            currentTool={workingSessionState.activeDraft.toolType}
            requestedTool={pendingToolRequest.toolType}
            onSuspend={() => finishInterruption("keep_draft")}
            onContinue={() => setPendingToolRequest(null)}
            onDiscard={() => finishInterruption("discard_geometry")}
          />
        )}

        <div className={`${mode === "local_feature" ? "hidden " : ""}absolute top-4 right-4 z-[900] w-72 bg-white/95 backdrop-blur-md p-2 rounded-[20px] shadow-lg border border-[#e1e3e4]`}>
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
                <span>Move Route Node</span>
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

        {mode !== "select" && mode !== "move" && mode !== "local_feature" && selected?.type !== "path_point"
          && !(mode === "path" && networkBrowserOpen && (
            activePathway?.status === "Active"
            || activePathway?.status === "Closed"
            || (!activePathway && currentPathways.some((pathway) => pathway.status !== "Open"))
          )) && (
          <aside className="absolute top-20 right-4 z-[901] w-80 max-h-[calc(100%-100px)] overflow-y-auto bg-white/98 backdrop-blur-md p-5 rounded-[28px] shadow-2xl border border-[#e1e3e4]">
            {error && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
                {error}
              </div>
            )}

            {mode === "area" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Building Footprint</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">{editingBuildingId ? "Change Building Footprint" : polygonClosed ? "Create or Attach Building" : "Draw Building Footprint"}</h2>
                {editingBuildingId ? (
                  <section aria-label="Change scope" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <h3 className="text-xs font-extrabold text-[#005931]">Change scope</h3>
                    <p className="mt-1 text-xs leading-5 text-[#3f4941]">
                      This action edits only the linked Building Footprint geometry. The Building Campus Location and its details are unchanged.
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-full border border-[#005931] bg-white px-3 py-1.5 text-xs font-bold text-[#005931]"
                      onClick={() => {
                        const buildingId = editingBuildingId;
                        cancelBuildingDraft();
                        if (buildingId) {
                          setSelected({ type: "building", id: buildingId });
                          setOwnerModal("location");
                        }
                      }}
                    >
                      Open Building details ↗
                    </button>
                  </section>
                ) : polygonClosed ? (
                  <section aria-label="Create or attach Building" className="mt-3">
                    <p className="text-xs text-[#3f4941]">The footprint is complete. Choose the Building it should represent.</p>
                    {footprintOverlapWarning && (
                      <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800" role="status">
                        ⚠️ {footprintOverlapWarning.message}
                      </div>
                    )}
                    <div role="tablist" aria-label="Building workflow" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#edf3ef] p-1">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={buildingWorkflowMode === "create"}
                        onClick={() => setBuildingWorkflowMode("create")}
                        className={`rounded-lg px-2 py-2 text-xs font-bold ${buildingWorkflowMode === "create" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        ★ Create New Building
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={buildingWorkflowMode === "attach"}
                        onClick={() => setBuildingWorkflowMode("attach")}
                        className={`rounded-lg px-2 py-2 text-xs font-bold ${buildingWorkflowMode === "attach" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        🔗 Attach Existing Building
                      </button>
                    </div>
                    {buildingWorkflowMode === "create" ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-[#3f4941]">Add the Building identity and descriptive details before committing this footprint.</p>
                        <button type="button" className="w-full rounded-xl border border-[#005931] bg-emerald-50 px-3 py-2 text-xs font-bold text-[#005931]" onClick={() => setBuildingDetailsModalOpen(true)}>
                          {buildingName.trim() || buildingCode.trim() ? "Open Building details" : "Add Building details"}
                        </button>
                        {(buildingName.trim() || buildingCode.trim()) && <p className="text-[11px] text-[#526359]">{buildingName || "Unnamed Building"} {buildingCode ? `· ${buildingCode}` : ""}</p>}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <input
                          type="search"
                          aria-label="Search existing Buildings"
                          value={attachBuildingSearch}
                          onChange={(event) => setAttachBuildingSearch(event.target.value)}
                          placeholder="Search by name or code"
                          className="w-full rounded-lg border border-[#dbe0e2] px-2 py-2 text-sm"
                        />
                        <div className="space-y-2 max-h-52 overflow-y-auto">
                          {attachCandidateBuildings.length === 0 ? (
                            <p className="p-3 text-center text-xs text-[#526359]">No eligible Buildings available to attach.</p>
                          ) : (
                            attachCandidateBuildings.map((building) => (
                              <button
                                key={building.id}
                                type="button"
                                aria-pressed={selectedAttachBuildingId === building.id}
                                onClick={() => setSelectedAttachBuildingId(building.id)}
                                className={`w-full rounded-xl border p-2 text-left text-xs transition cursor-pointer ${
                                  selectedAttachBuildingId === building.id
                                    ? "border-[#005931] bg-emerald-50 text-[#005931]"
                                    : "border-[#dbe0e2] hover:bg-[#f8f9fa]"
                                }`}
                              >
                                <span className="block font-bold">{building.name} · {building.code}</span>
                                <span className="mt-1 block text-emerald-700 font-medium">Eligible</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                ) : (
                  <div>
                    <p className="text-xs text-[#3f4941] mt-1">
                      Click on the map to plot the perimeter corners of the building footprint. A minimum of 3 points is required to form a closed polygon.
                    </p>
                    <div className="flex items-center gap-1 my-3 bg-[#edf3ef] p-1 rounded-xl" role="group" aria-label="Footprint interaction mode">
                      <button
                        type="button"
                        onClick={() => setPolygonInteraction("draw")}
                        className={`flex-1 rounded-lg py-1 text-xs font-bold ${polygonInteraction === "draw" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        Draw
                      </button>
                      <button
                        type="button"
                        disabled={points.length < 3}
                        onClick={() => setPolygonInteraction("reshape")}
                        className={`flex-1 rounded-lg py-1 text-xs font-bold disabled:opacity-40 ${polygonInteraction === "reshape" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        Reshape
                      </button>
                      <button
                        type="button"
                        disabled={points.length < 3}
                        onClick={() => setPolygonInteraction("move")}
                        className={`flex-1 rounded-lg py-1 text-xs font-bold disabled:opacity-40 ${polygonInteraction === "move" ? "bg-white text-[#005931] shadow" : "text-[#526359]"}`}
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )}
                <div className="text-xs font-bold text-[#191c1d] my-3">Points plotted: {points.length}</div>
                {points.length >= 3 && (
                  <div className="mb-2 text-[11px] text-[#526359]">
                    Derived label anchor: {polygonFeatureAnchor(points).map((c) => c.toFixed(5)).join(", ")}
                  </div>
                )}
                {footprintGeometryIssues.length > 0 && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700" role="alert">
                    {footprintGeometryIssues[0].message}
                  </div>
                )}
                {!polygonClosed && footprintOverlapWarning && (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800" role="status">
                    ⚠️ {footprintOverlapWarning.message}
                  </div>
                )}
                {points.length > 0 && polygonInteraction === "reshape" && (
                  <div className="mb-3 space-y-1 max-h-36 overflow-y-auto">
                    {points.map((point, index) => (
                      <div key={`${point.join(",")}-${index}`} className="flex items-center justify-between rounded-lg bg-[#f8f9fa] px-2 py-1 text-xs">
                        <span>V{index + 1} · {point[0].toFixed(5)}, {point[1].toFixed(5)}</span>
                        <button type="button" disabled={points.length <= 3} onClick={() => deletePolygonVertex(index)} className="text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
                {!polygonClosed && (
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
                    <button
                      type="button"
                      disabled={!canFinishFootprint}
                      onClick={closePolygon}
                      className="px-3 py-1.5 bg-emerald-50 border border-[#005931] text-[#005931] rounded-full text-xs font-bold hover:bg-emerald-100 disabled:opacity-40 transition cursor-pointer"
                    >
                      Save shape
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
                  <button
                    type="button"
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                    onClick={cancelBuildingDraft}
                  >
                    Cancel
                  </button>
                  {!editingBuildingId && polygonClosed && (
                    <button
                      type="button"
                      className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                      onClick={() => setPolygonClosed(false)}
                    >
                      ▱ Edit Shape
                    </button>
                  )}
                  {(editingBuildingId || (polygonClosed && buildingWorkflowMode === "attach")) && <button
                    type="button"
                    disabled={editingBuildingId
                      ? !canFinishFootprint
                      : buildingWorkflowMode === "attach" ? !selectedAttachBuildingId || !selectedAttachEligibility?.eligible : !canSaveBuilding}
                    onClick={editingBuildingId
                      ? handleSaveBuilding
                        : buildingWorkflowMode === "create" ? () => setBuildingDetailsModalOpen(true) : handleAttachBuilding}
                    className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    {editingBuildingId
                      ? "Apply footprint change"
                      : buildingWorkflowMode === "create" ? "Open Building details" : "Attach Selected Building"}
                  </button>}
                </div>
              </div>
            ) : mode === "place" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Place on Map</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Place Route Node</h2>
                <div className="flex flex-col gap-1.5 my-2">
                  <label className="text-xs font-semibold text-[#3f4941]">Route Node type</label>
                  <select
                    aria-label="Route Node type"
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
                  <label className="text-xs font-semibold text-[#3f4941]">Route Node name</label>
                  <input
                    type="text"
                    aria-label="Route Node name"
                    placeholder="e.g. CAS Entrance"
                    value={placingNodeName}
                    onChange={(e) => setPlacingNodeName(e.target.value)}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 my-2">
                  <label className="text-xs font-semibold text-[#3f4941]">Building association</label>
                  <select
                    aria-label="Route Node association"
                    value={placingAssociatedBuildingId ?? ""}
                    onChange={(e) => setPlacingAssociatedBuildingId(e.target.value || null)}
                    disabled={placingNodeType !== "Entrance"}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  >
                    <option value="">No Building association</option>
                    {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>
                      {building.name} ({building.code})
                    </option>)}
                  </select>
                  <span className="mt-1 block text-[10px] text-[#526359]">Building choices are preview-only; this association is not persisted yet.</span>
                </div>
                <div className="my-2 text-xs text-[#3f4941]">
                  {temporary
                    ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                    : "Click the map to position this Route Node."}
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
                    Save Route Node
                  </button>
                </div>
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
                    <section aria-label="Pathway metadata" className="mt-3 rounded-xl border border-[#dbe0e2] p-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-[#3f4941]">Pathway name
                          <input aria-label="New Pathway name" placeholder="e.g. Science Walk" value={pathwayDraft?.name ?? activePathway.name} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs font-semibold text-[#3f4941]">Way type
                          <select aria-label="New Pathway type" value={pathwayDraft?.type ?? activePathway.type} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                            {["Walkway", "Road"].map((wayType) => <option key={wayType}>{wayType}</option>)}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-[#3f4941]">Shade
                          <select aria-label="New Pathway shade" value={pathwayDraft?.shade ?? activePathway.shade} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs"><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs font-semibold text-[#3f4941]">Direction<select aria-label="New Pathway direction" value={pathwayDraft?.direction ?? activePathway.direction} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs"><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
                          <label className="text-xs font-semibold text-[#3f4941]">Status<select aria-label="New Pathway status" value={pathwayDraft?.status ?? activePathway.status} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">{activePathway.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></select></label>
                        </div>
                        <fieldset className="mt-2 rounded-xl border border-[#dbe0e2] p-2.5">
                          <legend className="px-1 text-xs font-semibold text-[#3f4941]">Allowed modes</legend>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {["Walking", "Vehicle"].map((mode) => {
                              const allowedModes = pathwayDraft?.allowedModes ?? activePathway.allowedModes ?? ["Walking"];
                              const vehicleBlocked = (pathwayDraft?.type ?? activePathway.type) === "Walkway" && mode === "Vehicle";
                              return <label key={mode} className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={vehicleBlocked} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>;
                            })}
                          </div>
                        </fieldset>
                      </div>
                    </section>
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
                        Drag the selected Path Point to move it, or click the map to add Path Points.{" "}
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
                      {activePathway.status === "Open" && <button type="button" aria-pressed={manualPathPointDrag} onClick={() => setManualPathPointDrag((enabled) => !enabled)} className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4]">
                        {manualPathPointDrag ? "Stop Dragging" : "Drag Path Point"}
                      </button>}
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
                        Apply Pathway
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
                <button
                  type="button"
                  className="mt-2 px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold"
                  onClick={() => initializeBuildingFootprintEdit(selectedBuilding, "reshape")}
                >
                  Edit Footprint
                </button>
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
                    {(selectedBuilding.type ?? selectedBuildingLocation?.type) === "Building" && <button type="button" className="px-2.5 py-1.5 bg-[#005931] text-white rounded-full text-[10px] font-bold" onClick={() => setAddRoomOpen(true)}>＋ Add Room</button>}
                  </div>
                  {(() => {
                    const children = currentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name);
                    const grouped = new Map<string, Location[]>();
                    children.forEach((child) => { const key = child.floor || "Unassigned floor"; grouped.set(key, [...(grouped.get(key) ?? []), child]); });
                    return grouped.size ? [...grouped.entries()].map(([floor, rooms]) => <div key={floor} className="mt-3"><div className="text-[10px] font-bold uppercase tracking-wide text-[#005931]">{floor}</div>{rooms.map((room) => <div key={room.id} className="flex justify-between gap-2 py-1 text-xs"><span className="font-semibold">{room.name}</span><span className="text-[#6b7280]">{room.code}</span></div>)}</div>) : <p className="mt-2 text-xs text-[#6b7280]">No rooms yet.</p>;
                  })()}
                </section>
                <section aria-label="Building entrances" className="mt-3 rounded-xl border border-[#dbe0e2] p-3">
                  <div className="flex items-center justify-between"><h3 className="text-xs font-extrabold text-[#191c1d]">Entrance nodes</h3><button type="button" className="text-[10px] font-bold text-[#005931]" onClick={() => { setPlacingNodeType("Entrance"); setPlacingNodeName(""); setPlacingAssociatedBuildingId(selectedBuildingAssociationId ?? selectedBuilding.id); setMode("place"); }}>＋ Place Entrance</button></div>
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
                <div className="text-xs text-[#3f4941]">{selectedLocation.type} · Campus Location</div>
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
                    <dt className="text-[#3f4941] font-medium">Parent</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.building || selectedLocation.parentId || "—"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Spatial source</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.type === "Building" || selectedLocation.type === "Facility" ? "Linked building footprint" : "Inherited from parent"}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <button type="button" onClick={() => setSelected(null)} className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer">
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedNode ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Route Node</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node name
                  <input aria-label="Route Node name" value={routeNodeFrame?.name ?? selectedNode.name} onChange={(event) => setRouteNodeDraft({ ...(routeNodeFrame ?? selectedNode), name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node type
                  <select aria-label="Route Node type" value={routeNodeFrame?.nodeType ?? selectedNode.nodeType} onChange={(event) => { const nodeType = event.target.value as RouteNode["nodeType"]; setRouteNodeDraft({ ...(routeNodeFrame ?? selectedNode), nodeType, associatedPlaceId: nodeType === "Entrance" ? routeNodeFrame?.associatedPlaceId ?? null : null }); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                    <option>Entrance</option><option>Junction</option><option>Access Point</option>
                  </select>
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Associated Building
                  <select aria-label="Associated Building" value={routeNodeFrame?.associatedPlaceId ?? ""} onChange={(event) => setRouteNodeDraft({ ...(routeNodeFrame ?? selectedNode), associatedPlaceId: event.target.value || null })} disabled={(routeNodeFrame?.nodeType ?? selectedNode.nodeType) !== "Entrance"} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs disabled:bg-[#f8f9fa]">
                    <option value="">None</option>
                    {selectedNode.associatedPlaceId && !currentLocations.some((location) => location.id === selectedNode.associatedPlaceId) && (
                      <option value={selectedNode.associatedPlaceId}>Missing Building ({selectedNode.associatedPlaceId})</option>
                    )}
                    {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
                  </select>
                  <span className="mt-1 block text-[10px] text-[#526359]">Building choices are preview-only; this association is not persisted yet.</span>
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
                  <input aria-label="Pathway name" value={pathwayFrame?.name ?? selectedPath.name} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
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

        {inspectorModel && (mode === "select" || selected?.type === "path_point" || selected?.type === "pathway") && (
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

      {buildingDetailsModalOpen && polygonClosed && buildingWorkflowMode === "create" && !editingBuildingId && (
        <BuildingDetailsModal
          draft={buildingForm}
          error={error}
          onChange={setBuildingForm}
          onClose={closeBuildingDetailsModal}
          onSubmit={handleCreateBuilding}
        />
      )}

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

      {addRoomOpen && selectedBuilding && (
        <Modal title="Add Room" subtitle={`Add an indoor Room under ${selectedBuilding.name}.`} size="sm" variant="green" onClose={() => setAddRoomOpen(false)}>
          <label className="block text-xs font-semibold text-[#3f4941]">Name
            <input aria-label="New room name" value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Code
            <input aria-label="New room code" value={newRoom.code} onChange={(e) => setNewRoom({ ...newRoom, code: e.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Floor
            <input aria-label="New room floor" value={newRoom.floor} onChange={(e) => setNewRoom({ ...newRoom, floor: e.target.value })} placeholder="2nd Floor" className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
          </label>
          <div className="modal-actions"><Button variant="subtle" onClick={() => setAddRoomOpen(false)}>Cancel</Button><Button disabled={!newRoom.name.trim() || !newRoom.code.trim()} onClick={handleSaveNewRoom}>Add Room</Button></div>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={
            confirm === "save" ? "Save map changes?" : "Discard changes?"
          }
          subtitle={
            confirm === "save"
              ? "Save this Working Session to the Admin Draft gateway."
              : "Discard uncommitted marker and shape drafts."
          }
          size="sm"
          variant={confirm === "save" ? "green" : "danger"}
          onClose={() => setConfirm(null)}
        >
          <p className="text-xs text-[#3f4941] my-2">
            {confirm === "save"
              ? "This fixture-backed Admin Draft simulation saves the complete finalized session; it does not publish the map."
              : "Unsaved marker, node, and pathway edits will be lost."}
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
              variant={confirm === "save" ? "primary" : "danger"}
            >
              {confirm === "save" ? "Save Changes" : "Discard"}
            </Button>
          </div>
        </Modal>
      )}
      {lifecycleConfirmation && (
        <Modal
          title={`${lifecycleActionLabel(lifecycleConfirmation.action)}?`}
          subtitle="Review the Walking Network impact before confirming."
          size="sm"
          variant="danger"
          onClose={() => setLifecycleConfirmation(null)}
        >
          <div className="space-y-2 text-xs text-[#3f4941]" role="document">
            <p><strong>{lifecycleConfirmation.impact.object.name}</strong> keeps its identity, geometry, metadata, associations, and history. Related records will not be deleted or changed.</p>
            <p><strong>Connected Pathways:</strong> {lifecycleConfirmation.impact.connectedPathways.length ? lifecycleConfirmation.impact.connectedPathways.map((pathway) => pathway.name).join(", ") : "None"}</p>
            <p><strong>Affected Entrance Route Nodes:</strong> {lifecycleConfirmation.impact.affectedEntrances.length ? lifecycleConfirmation.impact.affectedEntrances.map((node) => node.name).join(", ") : "None"}</p>
            {lifecycleConfirmation.impact.affectedBuildings.length > 0 && <p><strong>Buildings reviewed:</strong> {lifecycleConfirmation.impact.affectedBuildings.map((building) => building.name).join(", ")}</p>}
            {lifecycleConfirmation.impact.buildingsLosingRoutability.length > 0 && <p className="text-red-700"><strong>Will lose routability:</strong> {lifecycleConfirmation.impact.buildingsLosingRoutability.map((building) => building.name).join(", ")}. Add another active Entrance Route Node or keep this network object active.</p>}
            {lifecycleConfirmation.impact.buildingsRegainingRoutability.length > 0 && <p className="text-green-700"><strong>Will regain routability:</strong> {lifecycleConfirmation.impact.buildingsRegainingRoutability.map((building) => building.name).join(", ")}.</p>}
            {lifecycleConfirmation.impact.findings.length > 0 && <div aria-label="Lifecycle findings" className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">{lifecycleConfirmation.impact.findings.map((finding) => <p key={`${finding.objectId}-${finding.message}`}><strong>{finding.severity === "blocking" ? "Blocking" : "Advisory"} · {finding.objectId}:</strong> {finding.message} Corrective action: {finding.correctiveAction}</p>)}</div>}
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setLifecycleConfirmation(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={lifecycleConfirmation.impact.findings.some((finding) => finding.severity === "blocking")}
              onClick={confirmLifecycleAction}
            >
              Confirm {lifecycleActionLabel(lifecycleConfirmation.action)}
            </Button>
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
                    validationError.message === "Associated Building does not exist."
                      ? "Associated Building"
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
              {draftReview.warnings && draftReview.warnings.length > 0 && (
                <div className="space-y-1 my-2">
                  <div role="status" className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl font-medium">
                    Advisory review: {draftReview.warnings.length} {draftReview.warnings.length === 1 ? "warning" : "warnings"} (non-blocking).
                  </div>
                  {draftReview.warnings.map((warning, index) => (
                    <div key={`warn-${index}`} className="p-2 border border-amber-100 rounded-xl bg-amber-50/50 text-xs text-amber-800">
                      <span className="font-bold">{warning.object.label}</span>: {warning.message}
                    </div>
                  ))}
                </div>
              )}
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
