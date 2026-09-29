import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { campusCenter } from "../../services/mockData";
import { Button, Modal } from "../../components/UI";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { isPointInBounds, overlayChanges, polygonFeatureAnchor, suggestedPathwayName, validateRouteNodeDraft } from "./mapEditing";
import { ToolInterruptionDialog, ToolRailDock } from "./ToolRailDock";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { InspectorCardHUD, type InspectorCardModel } from "./InspectorCardHUD";
import { LocalFeatureDetailsModal } from "./localFeature/LocalFeatureDetailsModal";
import { BuildingDetailsModal } from "./building/BuildingDetailsModal";
import { BuildingToolPanel } from "./building/BuildingToolPanel";
import { SelectedBuildingPanel } from "./building/SelectedBuildingPanel";
import { BuildingDraftLayer, BuildingFootprintLayer } from "./building/BuildingMapLayers";
import { buildingInspectorModel } from "./building/buildingInspectorModel";
import type { SelectedBuildingView } from "./building/selectedBuilding";
import { NetworkBrowser, type NetworkBrowserSelection } from "./NetworkBrowser";
import { MapLegend } from "./MapLegend";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import { normalizeMapLayers } from "../../services/mapLayers";
import type { ActiveToolDraft, SpatialDomain, ToolType } from "./types";
import { locationIdentityKey } from "../../lib/locationPolicy";
import {
  echagueCampusBoundary,
  geometryOnCampus,
  paddedCampusBounds,
  pointOnCampus,
  type MapPoint,
} from "./campusBoundary";
import {
  distanceInMeters,
  nudgePoint,
  type PointSnapTarget,
} from "./pointInteractions";
import { pathwayConnectionError, segmentMidpoints } from "./pathway/pathwayTopology";
import { calculateDeleteImpact, type DeleteImpact } from "./routeNode/routeNodeLifecycle";
import { createRouteNodeWorkflow } from "./routeNode/RouteNodeWorkflow";
import { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import { useRouteNodeFrame } from "./routeNode/useRouteNodeFrame";
import { usePathwayEditing } from "./pathway/usePathwayEditing";
import { PathPointConversionModal } from "./pathway/PathPointConversionModal";
import { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import { useLocalFeatureLayer } from "./localFeature/useLocalFeatureLayer";
import { useMapOverlay } from "./session/useMapOverlay";
import { useSavingAction } from "./session/useSavingAction";
import { useLocalFeatureEditing } from "./localFeature/useLocalFeatureEditing";
import { localFeatureInspectorModel } from "./localFeature/localFeatureInspectorModel";
import { createWorkingSessionJournal, type WorkingSessionKey } from "./WorkingSessionJournal";
import {
  findSelectionCandidates,
  type CanvasSelectionType,
  type SelectionCandidate,
} from "./selectionCandidates";
import {
  createIndoorLocationIcon,
  createLocationPinIcon,
  createNodeIcon,
  createPointIcon,
  createSplitIcon,
  createTempIcon,
} from "./mapIcons";
import { PointCoordinateInputs, PointMoveLayer } from "./PointMoveLayer";
import { MapController } from "./MapController";
import { belongsToBuilding, isIndoorLocation, isPositionedLocation } from "./indoorLocation/indoorLocations";
import { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import "leaflet/dist/leaflet.css";

const MAP_EDITOR_PROJECT_ID = "proj-echague";

export function MapEditor() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [workingSessionManager] = useState(() => new WorkingSessionManager());
  const [workingSessionJournal] = useState(() => createWorkingSessionJournal(window.localStorage));
  const workingSessionKey = useMemo<WorkingSessionKey | null>(() => session ? ({
    administratorId: session.id,
    projectId: MAP_EDITOR_PROJECT_ID,
  }) : null, [session?.id]);
  const [, setWorkingSessionRevision] = useState(0);
  const [pendingToolRequest, setPendingToolRequest] = useState<{
    toolType: ToolType;
    resumeDraftId?: string;
    openNetworkBrowser?: boolean;
  } | null>(null);

  useEffect(
    () => workingSessionManager.subscribe(() => {
      setWorkingSessionRevision((revision) => revision + 1);
    }),
    [workingSessionManager],
  );

  useEffect(() => {
    if (!workingSessionKey) return undefined;
    const stored = workingSessionJournal.load(workingSessionKey);
    if (stored) {
      workingSessionManager.hydrate(stored.snapshot);
      const recoveredDraft = workingSessionManager.getActiveDraft();
      if (recoveredDraft) restoreWorkingSessionDraft(recoveredDraft);
    }

    const saveRecovery = () => workingSessionJournal.save(workingSessionKey, {
      schemaVersion: 1,
      snapshot: workingSessionManager.exportSnapshot(),
    });
    saveRecovery();
    return workingSessionManager.subscribe(saveRecovery);
  }, [workingSessionJournal, workingSessionKey, workingSessionManager]);

  const routeNodeWorkflow = useMemo(() => createRouteNodeWorkflow({
    adapter: services.map,
    workingSession: workingSessionManager,
  }), [workingSessionManager]);
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
  const { data: locationDirectory } = useQuery({
    queryKey: ["locations", "map-directory"],
    queryFn: async () => {
      const first = await services.locations.list("", 1, 100);
      const pages = Math.ceil(first.total / first.pageSize);
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
          services.locations.list("", index + 2, first.pageSize)),
      );
      return [first, ...remaining].flatMap((page) => page.items);
    },
    retry: false,
  });

  const overlay = useMapOverlay(data?.buildings);
  const [ownerModal, setOwnerModal] = useState<"location" | "local_feature" | null>(null);

  const [mode, setMode] = useState<"select" | "place" | "path" | "area" | "move">(
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
  const [flyTargetZoom, setFlyTargetZoom] = useState(19);
  const flyTo = (point: [number, number], zoom = 19) => {
    setFlyTargetZoom(zoom);
    setFlyTarget(point);
  };
  const [frameBounds, setFrameBounds] = useState<[[number, number], [number, number]] | null>(null);
  const saving = useSavingAction();
  const { savingAction } = saving;
  const [linkingBuildingEntrance, setLinkingBuildingEntrance] = useState(false);


  const [deleteConfirmation, setDeleteConfirmation] = useState<{ kind: "building" | "route_node" | "pathway"; id: string; name: string; impact?: DeleteImpact } | null>(null);
  const [error, setError] = useState("");
  const [basemap, setBasemap] = useState<"street" | "satellite">("street");
  const [currentMapBounds, setCurrentMapBounds] = useState<L.LatLngBounds | null>(null);
  const [currentMapZoom, setCurrentMapZoom] = useState(18);
  const isOverviewZoom = currentMapZoom < 18;

  const refreshMapData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["map"] }),
      queryClient.invalidateQueries({ queryKey: ["locations"] }),
    ]);
  }, [queryClient]);



  const completeToolDraft = (toolType: Exclude<ToolType, "select">) => {
    const completionHandlers: Record<Exclude<ToolType, "select">, () => void> = {
      point: () => pointTool.setDraftDirty(false),
      polygon: () => undefined,
      pathway: () => {
        setPathDraftDirty(false);
        setProvisionalPathwayId(null);
      },
    };
    completionHandlers[toolType]();
    workingSessionManager.discardActiveDraft();
  };
  const handleViewportChange = useCallback((bounds: L.LatLngBounds | null, zoom: number) => {
    setCurrentMapBounds(bounds);
    setCurrentMapZoom(zoom);
  }, []);

  const directoryLocations = data?.locations || [];
  const directoryNodes = data?.nodes || [];
  const directoryPathways = data?.pathways || [];
  const directoryBuildings = (data?.buildings || []).filter((building) => building.points.length >= 3);
  // Local map features are retained by the data/service layer for compatibility,
  // but are intentionally not rendered in this editor. The campus boundary is
  // still used below for validation and navigation bounds.
  const campusBoundary = useMemo(
    () => directoryBuildings.find((building) => building.code === "CAMPUS_00" || /whole isu campus/i.test(building.name))?.points ?? echagueCampusBoundary,
    [directoryBuildings],
  );
  const directoryMapLayers = useMemo(() => normalizeMapLayers({
    buildings: data?.buildings || [],
    locations: data?.locations || [],
    routeNodes: data?.nodes || [],
    pathways: data?.pathways || [],
  }), [data?.buildings, data?.locations, data?.nodes, data?.pathways]);
  const localFeatureLayer = useLocalFeatureLayer(directoryMapLayers.featureLinks);
  const currentFeatureLinks = localFeatureLayer.currentFeatureLinks;
  const localFeatures = useLocalFeatureEditing({
    workingSession: workingSessionManager,
    layer: localFeatureLayer,
    onError: setError,
  });
  const currentLocations = useMemo(() => overlayChanges(directoryLocations, overlay.locations), [directoryLocations, overlay.locations]);
  const buildingContentLocations = useMemo(() => {
    const locationsById = new Map((locationDirectory ?? []).map((location) => [locationIdentityKey(location), location]));
    for (const location of currentLocations) locationsById.set(locationIdentityKey(location), location);
    return Array.from(locationsById.values());
  }, [currentLocations, locationDirectory]);
  const currentNodes = useMemo(() => overlayChanges(directoryNodes, overlay.nodes), [directoryNodes, overlay.nodes]);
  const pathway = usePathwayEditing({
    workingSession: workingSessionManager,
    overlay,
    saving,
    network: { directoryPathways, directoryNodes, nodes: currentNodes, campusBoundary },
    selectedPathId: selected?.type === "pathway" ? selected.id : null,
    refreshMapData,
    onError: setError,
  });
  const {
    currentPathways,
    pathwayCrossings,
    selectedPath,
    activePathway,
    pathwayFrame,
    pathwayFrameIssues,
    pathwayFrameDirty,
    editingPathId,
    setEditingPathId,
    pathwayDraft,
    setPathwayDraft,
    setPathwayDraftOriginal,
    provisionalPathwayId,
    setProvisionalPathwayId,
    pathPoints,
    setPathPoints,
    selectedPathPointIndex,
    setSelectedPathPointIndex,
    pathStartNodeId,
    setPathStartNodeId,
    pathDraftDirty,
    setPathDraftDirty,
    conversionDraft,
    setConversionDraft,
    pathPointDragPreview,
    setPathPointDragPreview,
    adoptSuggestedPathwayName,
    insertPathPoint,
    switchEndpoints: switchPathwayEndpoints,
    updateConversionPathway,
  } = pathway;
  const sessionBuildings = useMemo(() => {
    return overlayChanges(data?.buildings || [], overlay.buildings);
  }, [data?.buildings, overlay.buildings]);
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
    for (const location of locationDirectory ?? []) {
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
  }, [allSessionBuildings, locationDirectory]);
  const buildingEditor = useBuildingFootprintEditing({
    workingSession: workingSessionManager,
    layers: { overlay, localFeatures: localFeatureLayer },
    saving,
    context: {
      sessionBuildings,
      associationOptions: buildingAssociationOptions,
      locations: currentLocations,
      nodes: currentNodes,
      featureLinks: currentFeatureLinks,
      campusBoundary,
    },
    drawing: mode === "area",
    refreshMapData,
    onError: setError,
    onFinished: (outcome) => {
      setMode("select");
      if (outcome.kind !== "cancelled") setSelected({ type: "building", id: outcome.buildingId });
      if (outcome.kind === "placed") pointTool.setPlacingAssociatedBuildingId(outcome.buildingId);
      completeToolDraft("polygon");
    },
  });
  const {
    points,
    setPoints,
    polygonInteraction,
    polygonClosed,
    buildingWorkflowMode,
    buildingDetailsModalOpen,
    buildingClassification,
    setBuildingClassification,
    nonRoutableBuildingId,
    setNonRoutableBuildingId,
    buildingForm,
    setBuildingForm,
    editingBuildingId,
    currentBuildings,
    closeDetailsModal: closeBuildingDetailsModal,
    createBuilding: handleCreateBuilding,
  } = buildingEditor;
  const pointTool = useRouteNodePointTool({
    workflow: routeNodeWorkflow,
    overlay,
    saving,
    context: { buildings: currentBuildings, locations: currentLocations, nodes: currentNodes, campusBoundary },
    refreshMapData,
    onError: setError,
  });
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
        ...(source && !(mode === "move" && source.id === pointTool.movingId)
          ? [[source.lat, source.lng] as MapPoint]
          : []),
        ...pathway.pathPoints,
        ...(destination && !(mode === "move" && destination.id === pointTool.movingId)
          ? [[destination.lat, destination.lng] as MapPoint]
          : []),
      ].map((point) => ({ kind: "pathway_vertex" as const, point }));
    }),
  ], [currentBuildings, currentNodes, currentPathways, mode, pointTool.movingId]);
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
    () => localFeatureLayer.withFeatureChanges(normalizedLocalFeatures),
    [localFeatureLayer.withFeatureChanges, normalizedLocalFeatures],
  );

  const displaysOsmOverlays = [...currentBuildings, ...currentLocations, ...currentNodes, ...currentPathways]
    .some((item) => item.source?.provider === "OpenStreetMap");
  const navigationBounds = useMemo(() => {
    const bounds = paddedCampusBounds(campusBoundary);
    return [[bounds.south, bounds.west], [bounds.north, bounds.east]] as [[number, number], [number, number]];
  }, [campusBoundary]);
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
      (loc) => !isIndoorLocation(loc)
        && loc.type !== "Building"
        && (loc.type !== "Facility" || !currentBuildings.some((building) => building.id === loc.id))
        && (isPointInBounds(loc.lat, loc.lng, currentMapBounds) || (selected?.type === "location" && selected.id === loc.id))
    );
  }, [currentBuildings, currentLocations, currentMapBounds, mode, selected?.id, selected?.type]);

  const visibleIndoorLocations = useMemo(() => {
    if (currentMapZoom < 20) return [];
    return buildingContentLocations.filter((location) =>
      isIndoorLocation(location)
      && location.lat !== null
      && location.lng !== null
      && currentBuildings.some((building) => belongsToBuilding(location, building)),
    );
  }, [buildingContentLocations, currentBuildings, currentMapZoom]);
  const indoor = useIndoorLocationPlacement(
    overlay,
    { buildings: currentBuildings, locations: buildingContentLocations, zoom: currentMapZoom },
    setError,
  );
  const indoorPlacement = indoor.placement;

  const filteredNodes = useMemo(() => {
    if (mode === "place" || mode === "area") return [];
    return currentNodes.filter(
      (node) => isPointInBounds(node.lat, node.lng, currentMapBounds)
        || (selected?.type === "node" && selected.id === node.id)
    );
  }, [currentMapBounds, currentNodes, mode, selected?.id, selected?.type]);

  const filteredPathways = useMemo(() => {
    if (mode === "area") return [];
    return currentPathways;
  }, [currentPathways, mode]);

  // IDs are scoped to an entity type. A Pathway and an Indoor Location may
  // legitimately share a database ID, so every derived selection must cross
  // the typed identity seam rather than matching only the ID.
  const selectedLocation = selected?.type === "location"
    ? buildingContentLocations.find((item) => item.id === selected.id)
    : undefined;
  const selectedNode = selected?.type === "node"
    ? currentNodes.find((item) => item.id === selected.id)
    : undefined;
  const nodeFrame = useRouteNodeFrame(selectedNode, {
    workflow: routeNodeWorkflow,
    saving,
    context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
    onNodeSaved: overlay.putNode,
    refreshMapData,
    onError: setError,
  });
  const selectedBuilding = selected?.type === "building"
    ? currentBuildings.find((item) => item.id === selected.id)
    : undefined;
  const selectedLocalFeature = selected?.type === "local_feature"
    ? currentLocalFeatures.find((item) => item.id === selected.id)
    : undefined;
  const movingObjectName = selectedNode?.name ?? "Route Node";
  const movingOutsideBoundary = Boolean(
    mode === "move" && pointTool.position && !pointOnCampus(pointTool.position, campusBoundary),
  );
  const moveDistanceMeters = pointTool.moveOrigin && pointTool.position
    ? distanceInMeters(pointTool.moveOrigin, pointTool.position)
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
  const selectedBuildingView: SelectedBuildingView | null = selectedBuilding ? {
    building: selectedBuilding,
    location: selectedBuildingLocation,
    associationId: selectedBuildingAssociationId ?? selectedBuilding.id,
    entrances: selectedBuildingEntrances,
    hasFootprint: selectedBuildingHasFootprint,
    routable: selectedBuildingRoutable,
  } : null;

  useEffect(() => {
    const create = new URLSearchParams(routeLocation.search).get("create");
    if (create === "building") {
      activateTool("polygon");
      return;
    }
  }, [routeLocation.search]);

  useEffect(() => {
    const indoorLocationId = new URLSearchParams(routeLocation.search).get("indoorLocation");
    if (indoorLocationId) {
      if (!data) return;
      const indoorLocation = buildingContentLocations.find((item) => item.id === indoorLocationId && isIndoorLocation(item));
      const parentBuilding = indoorLocation
        ? currentBuildings.find((item) => item.id === indoorLocation.parentId || item.name === indoorLocation.building)
        : undefined;
      if (!indoorLocation || !parentBuilding) {
        setError("The indoor location or its parent Building could not be found.");
        navigate(routeLocation.pathname, { replace: true });
        return;
      }
      const shouldPlace = new URLSearchParams(routeLocation.search).get("place") === "1";
      setMode("select");
      setFrameBounds(null);
      setError("");
      if (isPositionedLocation(indoorLocation) && !shouldPlace) {
        indoor.setPlacement(null);
        setSelected({ type: "location", id: indoorLocation.id });
        flyTo([indoorLocation.lat, indoorLocation.lng], 20);
      } else {
        setSelected({ type: "location", id: indoorLocation.id });
        indoor.startPlacement(parentBuilding, indoorLocation);
        flyTo(polygonFeatureAnchor(parentBuilding.points), 20);
      }
      navigate(routeLocation.pathname, { replace: true });
      return;
    }

    const locationId = new URLSearchParams(routeLocation.search).get(
      "location",
    );
    const building = locationId ? currentBuildings.find((item) => item.id === locationId) : undefined;
    const loc = locationId ? directoryLocations.find((item) => item.id === locationId) : undefined;
    if (locationId && (building || loc)) {
      const buildingPoints = building?.points ?? [];
      // Locations may locate an existing record, but it must never hand off
      // into a standalone point-placement workflow. Footprint geometry stays
      // owned by Map Editor's Building Polygon tool.
      setMode("select");
      if (building) {
        setSelected({ type: "building", id: locationId });
        if (buildingPoints.length >= 3) {
          setFrameBounds([
            [Math.min(...buildingPoints.map(([lat]) => lat)), Math.min(...buildingPoints.map(([, lng]) => lng))],
            [Math.max(...buildingPoints.map(([lat]) => lat)), Math.max(...buildingPoints.map(([, lng]) => lng))],
          ]);
        }
      } else if (loc) {
        setSelected({ type: "location", id: locationId });
      }
      if (!building && loc && isPositionedLocation(loc)) {
        setFrameBounds(null);
        flyTo([loc.lat, loc.lng]);
      }
    }
  }, [buildingContentLocations, currentBuildings, data, directoryLocations, navigate, routeLocation.pathname, routeLocation.search]);

  useEffect(() => {
    const pathwayId = new URLSearchParams(routeLocation.search).get("pathway");
    if (!pathwayId) return;
    if (!data) return;
    const pathway = overlay.pathways.find((item) => item.id === pathwayId)
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
    if (source) flyTo([source.lat, source.lng]);
  }, [currentNodes, data, directoryPathways, overlay.pathways, routeLocation.search]);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const allLocs = directoryLocations.length ? directoryLocations : overlay.locations;
    const allNodes = directoryNodes.length ? directoryNodes : overlay.nodes;
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
  }, [currentPathways, directoryLocations, directoryNodes, overlay.locations, overlay.nodes, search]);

  const selectObject = useCallback(
    (type: "location" | "node" | "pathway" | "building" | "area" | "path_point" | "local_feature", id: string) => {
      setSelected({ type, id });
      setSelectionPopover(null);
      localFeatures.setActionNotice("");
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
          nodeFrame.load(node);
        }
      }
      pointTool.setPosition(null);
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
      const loc = directoryLocations.find((l) => l.id === item.id) || overlay.locations.find((l) => l.id === item.id);
      if (loc && isPositionedLocation(loc)) flyTo([loc.lat, loc.lng]);
    } else if (item.kind === "Route Node") {
      selectObject("node", item.id);
      const n = directoryNodes.find((node) => node.id === item.id) || overlay.nodes.find((node) => node.id === item.id);
      if (n) flyTo([n.lat, n.lng]);
    } else if (item.kind === "Pathway") {
      selectObject("pathway", item.id);
      const p = currentPathways.find((path) => path.id === item.id);
      if (p) {
        const src = directoryNodes.find((n) => n.id === p.sourceNodeId) || overlay.nodes.find((n) => n.id === p.sourceNodeId);
        if (src) flyTo([src.lat, src.lng]);
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
        flyTo([node.lat, node.lng]);
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

  const onMapClick = async (point: [number, number]) => {
    if (indoor.handleMapClick(point)) return;
    if (mode === "select") {
      setSelected(null);
      setSelectionPopover(null);
      return;
    }
    if (isOverviewZoom) {
      setError("Zoom in to edit map geometry.");
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
    } else if (mode === "place" || mode === "move") {
      pointTool.placeAt(point);
    } else if (mode === "path" && editingPathId) {
      setPathPoints((current) => [...current, point]);
      setPathDraftDirty(true);
    }
  };

  const handleStartMoveNode = () => {
    if (!selectedNode) return;
    pointTool.startMove(selectedNode);
    setMode("move");
  };

  const handleCancelMove = () => {
    pointTool.cancelMove();
    setMode("select");
    workingSessionManager.discardActiveDraft();
  };

  const handleSavePosition = async () => {
    const movedId = await pointTool.savePosition();
    if (!movedId) return;
    setMode("select");
    setSelected({ type: "node", id: movedId });
    completeToolDraft("point");
  };

  const handleSavePlacedNode = async () => {
    const placed = await pointTool.savePlacedNode();
    if (!placed) return;
    if (placed.draft.nodeType === "Entrance" && placed.draft.associatedPlaceId === nonRoutableBuildingId) {
      setNonRoutableBuildingId(null);
    }
    setMode("select");
    nodeFrame.load(placed.node);
    setSelected({ type: "node", id: placed.node.id });
    completeToolDraft("point");
  };

  const beginIndoorLocationPlacement = (building: Building, location: Location) => {
    if (!indoor.begin(building, location)) return;
    setSelected({ type: "location", id: location.id });
    flyTo(polygonFeatureAnchor(building.points), 20);
  };

  const saveIndoorLocationPosition = async () => {
    const positioned = await indoor.save();
    if (!positioned) return;
    setSelected({ type: "location", id: positioned.id });
    flyTo([positioned.lat!, positioned.lng!], 20);
  };

  const openIndoorLocationHandoff = (building: Building) => {
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
    navigate(`/locations?add=indoor&parentId=${encodeURIComponent(building.id)}`, {
      state: { indoorLocationParent: parent },
    });
  };

  const linkExistingEntrance = async (building: Building, node: RouteNode) => {
    const associatedPlaceId = selectedBuildingLocation?.id ?? building.id;
    const updated = { ...node, nodeType: "Entrance" as const, associatedPlaceId };
    const result = await routeNodeWorkflow.finalize({
      kind: "update",
      before: node,
      after: updated,
      context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
      description: `Link ${node.name} to ${building.name}`,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    try {
      updateNode(result.node);
      await refreshMapData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Entrance association was saved, but the map could not refresh.");
      return;
    }
    setLinkingBuildingEntrance(false);
    setSelected({ type: "building", id: building.id });
  };


  const finishPathwayTool = () => {
    setMode("select");
    completeToolDraft("pathway");
  };

  const handleSavePathShape = async () => {
    if (await pathway.saveShape()) finishPathwayTool();
  };

  const startNewPathway = () => {
    pathway.startNew();
    setSelected(null);
    setMode("path");
  };

  const createJunctionAtCrossing = () => pathway.createJunctionAtCrossing((junction) => {
    nodeFrame.load(junction);
    setSelected({ type: "node", id: junction.id });
    finishPathwayTool();
  });

  const startPathPointConversion = () => pathway.startConversion(currentBuildings);

  const savePathPointConversion = () => pathway.saveConversion((nodeId) => {
    setMode("select");
    setSelected({ type: "node", id: nodeId });
  });

  const applyPathwayFrame = async () => {
    if (await pathway.applyFrame()) finishPathwayTool();
  };

  const cancelPathwayFrame = () => {
    const outcome = pathway.cancelFrame();
    if (outcome.discarded) {
      setSelected(null);
      finishPathwayTool();
    } else {
      setSelected({ type: "pathway", id: outcome.pathwayId });
    }
  };

  const handleSaveBuilding = () => buildingEditor.saveBuilding(currentLocalFeatures);

  const initializeBuildingFootprintEdit = (
    building: Building,
    interaction: "draw" | "reshape" | "move" = "draw",
  ) => {
    buildingEditor.initializeFootprintEdit(building, interaction);
    setMode("area");
  };

  const startGuidedEntranceDraft = () => {
    const building = currentBuildings.find((candidate) => candidate.id === nonRoutableBuildingId);
    if (!building) return;
    pointTool.beginEntrancePlacement(`${building.name} Entrance`, building.id);
    setMode("place");
  };

  const updateLocation = overlay.putLocation;
  const updateNode = overlay.putNode;
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
    overlay.putPathways([updated]);
    setError("");
    return true;
  };
  const updateBuilding = overlay.putBuilding;






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
      point: () => pointTool.position && pointTool.draftDirty ? ({
        toolType: "point",
        label: "Route Node draft",
        provisionalGeometry: {
          points: [{ x: pointTool.position[1], y: pointTool.position[0], lat: pointTool.position[0], lng: pointTool.position[1] }],
        },
        nestedRecords: {
          editorMode: mode,
          ...pointTool.draftRecords,
          selected,
        },
      }) : null,
      polygon: () => buildingEditor.draftSnapshot,
      pathway: () => pathway.draftSnapshot,
    };
    return snapshotBuilders[activeTool]();
  }, [
    activeTool,
    buildingEditor.draftSnapshot,
    mode,
    pathway.draftSnapshot,
    pointTool.movingId,
    pointTool.draftDirty,
    pointTool.placingAssociatedBuildingId,
    pointTool.placingNodeName,
    pointTool.placingNodeType,
    pointTool.position,
    selected,
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
      point: () => pointTool.reset(),
      polygon: () => buildingEditor.clearToolDraft(),
      pathway: () => pathway.clearToolDraft(),
    };
    clearHandlers[toolType]();
  };

  const activateTool = (toolType: ToolType) => {
    const activationHandlers: Record<ToolType, () => void> = {
      select: () => {
        setMode("select");
        pointTool.reset();
      },
      point: () => {
        setMode("place");
        setSelected(null);
        pointTool.activatePlacement();
      },
      polygon: () => {
        setMode("area");
        buildingEditor.activate();
      },
      pathway: () => {
        setMode("path");
        setNetworkBrowserOpen(false);
        const opened = pathway.activate();
        if (opened) setSelected({ type: "pathway", id: opened.id });
      },
    };
    activationHandlers[toolType]();
  };

  const selectTool = (toolType: ToolType) => {
    if (toolType === activeTool) {
      if (toolType === "pathway") setNetworkBrowserOpen(false);
      return;
    }
    if (workingSessionManager.hasActiveDraft()) {
      setPendingToolRequest({ toolType });
      return;
    }
    activateTool(toolType);
  };

  const browseWalkingNetwork = () => {
    if (workingSessionManager.hasActiveDraft()) {
      setPendingToolRequest({ toolType: "select", openNetworkBrowser: true });
      return;
    }
    activateTool("select");
    setNetworkBrowserOpen(true);
  };

  function restoreWorkingSessionDraft(draft: ActiveToolDraft) {
    const restoredPoints = (draft.provisionalGeometry.points ?? []).map((point) => [
      point.lat ?? point.y,
      point.lng ?? point.x,
    ] as [number, number]);
    const records = draft.nestedRecords ?? {};

    const restoreHandlers: Record<ActiveToolDraft["toolType"], () => void> = {
      point: () => {
        pointTool.restoreDraft(restoredPoints[0] ?? null, records);
        setMode(records.editorMode === "move" ? "move" : "place");
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
        buildingEditor.restoreDraft(restoredPoints, records);
        setMode("area");
      },
      pathway: () => {
        pathway.restoreDraft(restoredPoints, draft.provisionalGeometry.startNodeId, records);
        setMode("path");
      },
    };
    restoreHandlers[draft.toolType]();
  }

  const restoreSuspendedDraft = (draftId: string) => {
    const draft = workingSessionManager.resumeSuspendedDraft(draftId);
    if (draft) restoreWorkingSessionDraft(draft);
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
    if (request.openNetworkBrowser) setNetworkBrowserOpen(true);
  };

  useEffect(() => {
    const position = pointTool.position;
    if (mode !== "move" || !position) return;
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
        if (pointOnCampus(position, campusBoundary)) handleSavePosition();
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
      pointTool.updateMovePosition(nudgePoint(position, direction, event.shiftKey ? 5 : 0.5));
    };
    window.addEventListener("keydown", handlePointMoveKey);
    return () => window.removeEventListener("keydown", handlePointMoveKey);
  }, [campusBoundary, mode, pointTool.position]);

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
  };
  const confirmDelete = async () => {
    if (!deleteConfirmation) return;
    try {
      if (deleteConfirmation.kind === "building") {
        await services.map.removeBuilding(deleteConfirmation.id);
        overlay.removeBuilding(deleteConfirmation.id);
        overlay.removeLocation(deleteConfirmation.id);
      } else if (deleteConfirmation.kind === "route_node") {
        await services.map.deleteRouteNode(deleteConfirmation.id);
        overlay.removeNode(deleteConfirmation.id);
      } else {
        await services.map.deletePathway(deleteConfirmation.id);
        overlay.deletePathway(deleteConfirmation.id);
      }
      await refreshMapData();
      setSelected(null);
      setDeleteConfirmation(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Failed to delete ${deleteConfirmation.name}. Retry when ready.`);
    }
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
    positioned: selectedBuildingLocation?.positioned ?? (selectedBuildingLocation?.lat != null && selectedBuildingLocation?.lng != null),
    hasPhoto: selectedBuildingLocation?.hasPhoto,
    photo: selectedBuildingLocation?.photo,
  } : null);



  const startSelectedBuildingGeometryEdit = () => {
    if (!selectedBuilding) return;
    initializeBuildingFootprintEdit(selectedBuilding, "reshape");
  };

  const inspectorModel = (() => {
    if (!selected) return null;
    if (selectedBuildingView) {
      return buildingInspectorModel({
        view: selectedBuildingView,
        contentLocations: buildingContentLocations,
        nodes: currentNodes,
        linkingEntrance: linkingBuildingEntrance,
        actions: {
          onReshape: startSelectedBuildingGeometryEdit,
          onEditDetails: () => setOwnerModal("location"),
          onAddIndoorLocation: () => openIndoorLocationHandoff(selectedBuildingView.building),
          onMarkIndoorLocation: () => { setError(""); indoor.setChooserOpen(true); },
          onAddEntrance: () => {
            pointTool.beginEntrancePlacement(`${selectedBuildingView.building.name} Entrance`, selectedBuildingView.associationId);
            setMode("place");
          },
          onToggleLinkEntrance: () => setLinkingBuildingEntrance((open) => !open),
          onLinkExistingEntrance: () => setLinkingBuildingEntrance(true),
          onLinkEntrance: (node) => linkExistingEntrance(selectedBuildingView.building, node),
          onDelete: () => setDeleteConfirmation({ kind: "building", id: selectedBuildingView.building.id, name: selectedBuildingView.building.name }),
        },
      });
    }
    if (selectedLocation) {
      const isFootprintOwner = selectedLocation.type === "Building" || selectedLocation.type === "Facility";
      const parentBuilding = selectedLocation.parentId
        ? currentBuildings.find((building) => building.id === selectedLocation.parentId)
          ?? currentLocations.find((location) => location.id === selectedLocation.parentId)
        : null;
      const locationSummary: InspectorCardModel["summary"] = [
        { label: "Code", value: selectedLocation.code },
        { label: "Type", value: selectedLocation.type },
        ...(!isFootprintOwner && !isIndoorLocation(selectedLocation) ? [{ label: "Parent building", value: selectedLocation.building || parentBuilding?.name || "—" }] : []),
        ...(!isFootprintOwner ? [{ label: "Floor", value: selectedLocation.floor || "—" }] : []),
        ...(selectedLocation.function ? [{ label: "Function", value: selectedLocation.function }] : []),
        ...(selectedLocation.keywords ? [{ label: "Keywords", value: selectedLocation.keywords }] : []),
        ...(selectedLocation.lat !== null && selectedLocation.lng !== null
          ? [{ label: "Coordinates", value: `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}` }]
          : []),
        { label: "Lifecycle", value: selectedLocation.status },
        ...(isFootprintOwner || !isIndoorLocation(selectedLocation)
          ? [{ label: "Spatial source", value: isFootprintOwner ? "Linked Building Footprint" : "Inherited from parent Building" }]
          : []),
      ];
      return {
        id: selectedLocation.id,
        kind: isFootprintOwner ? "building" : "campus_location",
        title: selectedLocation.name,
        domain: "Locations",
        status: isFootprintOwner
          ? "Campus Location · footprint geometry managed in Map Editor"
          : "Campus Location",
        summary: locationSummary,
        overflowActions: [
          { label: "✎ Edit Details", onSelect: () => setOwnerModal("location") },
        ],
      } satisfies InspectorCardModel;
    }
    if (selectedNode) {
      const stageRouteNodeEdit = (updated: RouteNode) => {
        nodeFrame.stage(updated);
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
                <input aria-label="Route Node name" value={nodeFrame.frame?.name ?? selectedNode.name} onChange={(event) => {
                  const name = event.target.value;
                  stageRouteNodeEdit({ ...(nodeFrame.frame ?? selectedNode), name });
                }} />
              </label>
              <label> Node type
                <select aria-label="Route Node type" value={nodeFrame.frame?.nodeType ?? selectedNode.nodeType} onChange={(event) => {
                  const nodeType = event.target.value as RouteNode["nodeType"];
                  stageRouteNodeEdit({ ...(nodeFrame.frame ?? selectedNode), nodeType, associatedPlaceId: nodeType === "Entrance" ? nodeFrame.frame?.associatedPlaceId ?? null : null });
                }}>
                  <option>Entrance</option><option>Junction</option><option>Access Point</option>
                </select>
              </label>
              {(nodeFrame.frame?.nodeType ?? selectedNode.nodeType) === "Entrance" && (
                <label> Building association
                  <select aria-label="Route Node association" value={nodeFrame.frame?.associatedPlaceId ?? ""} onChange={(event) => {
                    const associatedPlaceId = event.target.value || null;
                    stageRouteNodeEdit({ ...(nodeFrame.frame ?? selectedNode), associatedPlaceId });
                  }}>
                    <option value="">No Building association</option>
                    {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
                  </select>
                  <span className="mt-1 block text-[10px] text-[#526359]">Saved with the Route Node Update action.</span>
                </label>
              )}
            </div>
            <div className="inspector-inline-actions">
              <button type="button" onClick={nodeFrame.cancel} disabled={!nodeFrame.dirty}>Cancel</button>
              <button type="button" onClick={nodeFrame.apply} disabled={!nodeFrame.dirty || savingAction === "route-node-metadata"}>{savingAction === "route-node-metadata" ? "Updating Route Node…" : "Update Route Node"}</button>
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
              void routeNodeWorkflow.finalize({
                kind: "update",
                before: selectedNode,
                after: updated,
                context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
                description: `Convert ${selectedNode.name} to a standard Route Node`,
              }).then((result) => {
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                const confirmed = result.node;
                updateNode(confirmed);
                nodeFrame.load(confirmed);
                setError("");
              });
            },
          }] : []),
          {
            label: "🗑 Delete Route Node",
            tone: "danger" as const,
            onSelect: () => {
              setDeleteConfirmation({ kind: "route_node", id: selectedNode.id, name: selectedNode.name, impact: calculateDeleteImpact({ object: selectedNode, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
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
          { label: "Source Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.sourceNodeId)?.name ?? pathwayFrame?.sourceNodeId ?? selectedPath.sourceNodeId },
          { label: "Destination Route Node", value: currentNodes.find((node) => node.id === pathwayFrame?.destinationNodeId)?.name ?? pathwayFrame?.destinationNodeId ?? selectedPath.destinationNodeId },
          { label: "Path Sequence", value: `${selectedPath.pathPoints.length} intermediate point${selectedPath.pathPoints.length === 1 ? "" : "s"}` },
          { label: "Distance", value: selectedPath.distance },
        ],
        details: (
          <>
            <section className="inspector-related-section" aria-label="Pathway metadata">
              <h3>Pathway metadata</h3>
              <div className="inspector-edit-fields">
                <label>Pathway name<input aria-label="Pathway name" placeholder={pathwayFrame && (suggestedPathwayName(pathwayFrame, currentNodes) || "Select two named Route Nodes")} value={pathwayFrame?.name ?? selectedPath.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(pathwayFrame); }} onBlur={() => adoptSuggestedPathwayName(pathwayFrame)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
                <label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label>
                <label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label>
                <label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label>
                <label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? "Active"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}>{pathwayFrame?.status === "Open" && <option>Open</option>}<option>Active</option><option>Closed</option></select></label>
              </div>
              <fieldset className="mt-2 rounded-xl border border-[#dbe0e2] p-2.5"><legend className="px-1 text-xs font-semibold text-[#3f4941]">Allowed modes</legend><div className="grid grid-cols-2 gap-2 text-xs">{["Walking", "Vehicle"].map((mode) => { const allowedModes = pathwayFrame?.allowedModes ?? ["Walking"]; const vehicleBlocked = pathwayFrame?.type === "Walkway" && mode === "Vehicle"; return <label key={mode} className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={vehicleBlocked} checked={!vehicleBlocked && allowedModes.includes(mode as "Walking" | "Vehicle")} onChange={(event) => setPathwayDraft((current) => current ? { ...current, allowedModes: event.target.checked ? [...new Set([...allowedModes, mode as "Walking" | "Vehicle"])] : allowedModes.filter((item) => item !== mode) } : current)} />{mode}</label>; })}</div></fieldset>
            </section>
            <section className="inspector-related-section" aria-label="Path Sequence editor">
              <h3>Path Sequence</h3>
              <button type="button" className="inspector-secondary-action" onClick={switchPathwayEndpoints} disabled={!pathwayFrame} aria-label="Switch source and destination">
                ⇄ Switch source and destination
              </button>
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
          label: savingAction === "pathway-metadata" ? "Updating Pathway…" : "Update Pathway",
          disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === "pathway-metadata",
          disabledReason: pathwayFrameIssues[0]?.message,
          onSelect: applyPathwayFrame,
        },
        overflowActions: [
          { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: cancelPathwayFrame },
          { label: "⌁ Reshape Pathway", onSelect: () => { setEditingPathId(selectedPath.id); setPathPoints(selectedPath.pathPoints); setMode("path"); } },
          {
            label: "🗑 Delete Pathway",
            tone: "danger" as const,
            onSelect: () => {
              setDeleteConfirmation({ kind: "pathway", id: selectedPath.id, name: selectedPath.name, impact: calculateDeleteImpact({ object: selectedPath, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
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
            {(pathwayFrameDirty || pathDraftDirty) && <p role="status">Update Pathway before converting this Path Point.</p>}
            <section className="inspector-related-section" aria-label="Parent Pathway metadata"><h3>Parent Pathway metadata</h3><div className="inspector-edit-fields"><label>Shade<select aria-label="Pathway shade" value={pathwayFrame?.shade ?? activePathway?.shade ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, shade: event.target.value as Pathway["shade"] } : current)}><option>Fully Shaded</option><option>Mostly Shaded</option><option>Partial Shade</option><option>Unshaded</option><option>Unknown</option></select></label><label>Way type<select aria-label="Pathway type" value={pathwayFrame?.type ?? activePathway?.type ?? "Walkway"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, type: event.target.value as Pathway["type"], allowedModes: event.target.value === "Walkway" ? ["Walking"] : current.allowedModes ?? ["Walking"] } : current)}><option>Walkway</option><option>Road</option></select></label><label>Direction<select aria-label="Pathway direction" value={pathwayFrame?.direction ?? activePathway?.direction ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, direction: event.target.value as Pathway["direction"] } : current)}><option>Two-way</option><option>One-way</option><option>Unknown</option></select></label><label>Status<select aria-label="Pathway status" value={pathwayFrame?.status ?? activePathway?.status ?? "Unknown"} onChange={(event) => setPathwayDraft((current) => current ? { ...current, status: event.target.value as Pathway["status"] } : current)}><option>Open</option><option>Closed</option><option>Unknown</option></select></label></div></section>
            <div className="inspector-inline-actions"><button type="button" onClick={cancelPathwayFrame} disabled={!pathwayFrameDirty}>Cancel</button></div>
          </>
        ),
        primaryAction: {
          label: savingAction === "pathway-metadata" ? "Updating Pathway…" : "Update Pathway",
          disabled: !pathwayFrameDirty || pathwayFrameIssues.length > 0 || savingAction === "pathway-metadata",
          disabledReason: pathwayFrameIssues[0]?.message,
          onSelect: applyPathwayFrame,
        },
        overflowActions: [
          { label: "✓ Update Pathway", onSelect: applyPathwayFrame },
          { label: "Cancel changes", disabled: !pathwayFrameDirty, onSelect: cancelPathwayFrame },
          { label: "Convert to Route Node", disabled: pathwayFrameDirty || pathDraftDirty || activePathway?.status === "Closed", onSelect: startPathPointConversion },
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
      return localFeatureInspectorModel({
        feature: selectedLocalFeature,
        actionNotice: localFeatures.actionNotice,
        onNotice: localFeatures.setActionNotice,
        onRestore: () => localFeatures.restoreFeature(selectedLocalFeature),
        onEditDetails: () => setOwnerModal("local_feature"),
        onRetire: () => localFeatures.retireFeature(selectedLocalFeature),
      });
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
            key={basemap}
            maxNativeZoom={basemap === "satellite" ? 18 : 19}
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
            flyTargetZoom={flyTargetZoom}
            frameBounds={frameBounds}
            navigationBounds={navigationBounds}
            onViewportChange={handleViewportChange}
          />

          <BuildingFootprintLayer
            buildings={filteredBuildings}
            selectedBuildingId={selected?.type === "building" ? selected.id : null}
            mode={mode}
            editingBuildingId={editingBuildingId}
            featureLinks={currentFeatureLinks}
            localFeatures={currentLocalFeatures}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onSelectBuilding={(buildingId, anchor) => selectCanvasObject("building", buildingId, anchor)}
            onSelectLocalFeature={(featureId) => selectObject("local_feature", featureId)}
          />

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
            const isSelected = (selected?.type === "pathway" && selected.id === path.id) || isEditingThisPath;

            const pathOpacity =
              mode === "place" || mode === "area"
                ? 0.25
                : isSelected
                  ? 0.95
                  : 0.8;

            return source && destination ? (
              <Polyline
                key={path.id}
                bubblingMouseEvents={false}
                positions={[
                  [source.lat, source.lng],
                  ...currentPoints,
                  [destination.lat, destination.lng],
                ]}
                pathOptions={{
                  className: "map-pathway",
                  color: !geometryOnCampus([
                    ...(source ? [[source.lat, source.lng] as [number, number]] : []),
                    ...currentPoints,
                    ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
                  ], campusBoundary) ? "#b42318" : isSelected ? "#e67e22" : "#005931",
                  weight: isSelected ? 6 : isOverviewZoom ? 2 : mode === "path" ? 5 : 4,
                  dashArray: isSelected || isOverviewZoom ? undefined : "7 6",
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
                {!isOverviewZoom && <Tooltip sticky direction="top" className="map-label">
                  <div className="font-bold text-xs">{path.name || "Campus Pathway"}</div>
                  <div className="text-[10px] text-gray-500 font-normal">Shade: {path.shade} · {path.direction}</div>
                  {!geometryOnCampus([
                    ...(source ? [[source.lat, source.lng] as [number, number]] : []),
                    ...currentPoints,
                    ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
                  ], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>}
              </Polyline>
            ) : null;
          })}

          {filteredLocations.map((loc) => {
            const isSelected = selected?.type === "location" && selected?.id === loc.id;
            if (isOverviewZoom && !isSelected) return null;
            return (
              <Marker
                key={`location:${loc.id}`}
                position={[loc.lat, loc.lng]}
                icon={createLocationPinIcon(isSelected)}
                eventHandlers={{
                  click: () => {
                    selectCanvasObject("location", loc.id, [loc.lat, loc.lng]);
                  },
                }}
              >
                {!isOverviewZoom && <Tooltip direction="top" offset={[0, -28]} className="map-label">
                  <div className="font-bold text-xs">{loc.name}</div>
                  <div className="text-[10px] text-gray-500 font-normal">{loc.type} · {loc.code}</div>
                  {!pointOnCampus([loc.lat, loc.lng], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>}
                <Popup>
                  <strong>{loc.name}</strong>
                  <br />
                  <small>{loc.type} · {loc.code}</small>
                </Popup>
              </Marker>
            );
          })}

          {visibleIndoorLocations.map((location) => {
            if (indoorPlacement?.locationId === location.id) return null;
            const isSelected = selected?.type === "location" && selected.id === location.id;
            const building = currentBuildings.find((item) => belongsToBuilding(location, item));
            return (
              <Marker
                key={`indoor-location:${location.id}`}
                position={[location.lat!, location.lng!]}
                icon={createIndoorLocationIcon(location.type, isSelected)}
                eventHandlers={{
                  click: () => {
                    setSelectionPopover(null);
                    setSelected({ type: "location", id: location.id });
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -12]} className="map-label">
                  <div className="font-bold text-xs">{location.name}</div>
                  <div className="text-[10px] text-gray-500 font-normal">{building?.name ?? location.building} · {location.type}</div>
                </Tooltip>
              </Marker>
            );
          })}

          {indoorPlacement?.position && (() => {
            const location = buildingContentLocations.find((item) => item.id === indoorPlacement.locationId);
            return location ? <Marker
              key={`indoor-placement-preview:${location.id}`}
              position={indoorPlacement.position}
              icon={createIndoorLocationIcon(location.type, true)}
            /> : null;
          })()}

          {filteredNodes.map((node) => {
            if (mode === "move" && pointTool.movingId === node.id) return null;
            const isSelected = selected?.type === "node" && selected?.id === node.id;
            if (isOverviewZoom && !isSelected) return null;
            return (
              <Marker
                key={node.id}
                position={[node.lat, node.lng]}
                icon={createNodeIcon(isSelected)}
                eventHandlers={{
                  click: () => {
                    if (mode === "path" && !editingPathId) {
                      if (isOverviewZoom) {
                        setError("Zoom in to edit map geometry.");
                        return;
                      }
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
                      const directDistance = Math.max(
                        1,
                        Math.round(distanceInMeters([source.lat, source.lng], [node.lat, node.lng])),
                      );
                      const newPath: Pathway = {
                        id: `pathway-${Date.now()}`,
                        name: "",
                        sourceNodeId: source.id,
                        destinationNodeId: node.id,
                        distance: `${directDistance} m`,
                        time: `${Math.max(1, Math.ceil(directDistance / 80))} min`,
                        shade: "Unknown",
                        type: "Walkway",
                        direction: "Two-way",
                        status: "Active",
                        allowedModes: ["Walking"],
                        pathPoints: [],
                      };
                      overlay.putPathways([newPath]);
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
                {!isOverviewZoom && <Tooltip direction="top" offset={[0, -10]} className="map-label">
                  <div className="font-bold text-xs">{node.name}</div>
                  <div className="text-[10px] text-gray-500 font-normal">Route Node ({node.nodeType})</div>
                  {!pointOnCampus([node.lat, node.lng], campusBoundary) && (
                    <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
                  )}
                </Tooltip>}
              </Marker>
            );
          })}

          {!isOverviewZoom && mode === "path" &&
            pathPoints.map((point, index) => (
              <Marker
                key={`path-point-${index}`}
                position={point}
                icon={createPointIcon(true)}
                draggable={selectedPathPointIndex === index}
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

          {!isOverviewZoom && mode === "path" && activePathway && (() => {
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

          <BuildingDraftLayer
            editor={buildingEditor}
            mode={mode}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onError={setError}
          />

          {!isOverviewZoom && mode === "move" && pointTool.moveOrigin && pointTool.position && (
            <PointMoveLayer
              origin={pointTool.moveOrigin}
              position={pointTool.position}
              snapTargets={pointSnapTargets}
              campusBoundary={campusBoundary}
              outsideBoundary={movingOutsideBoundary}
              distanceMeters={moveDistanceMeters}
              snapped={pointTool.snapped}
              onPositionChange={pointTool.updateMovePosition}
              onDropRejected={pointTool.rejectDrop}
              onDraggingChange={pointTool.setDragging}
            />
          )}

          {!isOverviewZoom && pointTool.position && mode !== "move" && (
            <Marker
              position={pointTool.position}
              icon={createTempIcon()}
              draggable={mode === "place"}
              eventHandlers={{
                drag: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  pointTool.editPosition([next.lat, next.lng]);
                },
                dragend: (event) => {
                  const next = (event.target as L.Marker).getLatLng();
                  const point: MapPoint = [next.lat, next.lng];
                  if (pointOnCampus(point, campusBoundary)) {
                    pointTool.setPosition(point);
                  } else {
                    setError("The new position must stay inside the ISU Echague campus boundary.");
                  }
                },
              }}
            />
          )}
        </MapContainer>

        {indoorPlacement && (
          <aside className="absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-2rem)] w-[min(24rem,calc(100%-2rem))] flex-col gap-4 overflow-auto rounded-2xl border border-[#dbe6df] bg-white/95 p-5 text-[#234333] shadow-xl backdrop-blur" aria-label="Indoor location position editor">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#426257]">INDOOR LOCATION</p>
              <h2 className="mt-1 text-lg font-extrabold text-[#191c1d]">{buildingContentLocations.find((location) => location.id === indoorPlacement.locationId)?.name ?? "Position location"}</h2>
              <p className="mt-1 text-xs text-[#526359]">{currentBuildings.find((building) => building.id === indoorPlacement.buildingId)?.name ?? "Parent Building"}</p>
            </div>
            <p role="status" className="rounded-xl bg-[#eff6f1] px-3 py-2.5 text-xs leading-relaxed">
              {indoorPlacement.position
                ? "Position preview selected. Click another point inside the building to change it."
                : "Click inside the building footprint to choose this location's position."}
              {currentMapZoom < 20 ? " Zoom to level 20 or closer." : ""}
            </p>
            {indoorPlacement.position && <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[#f7f9f8] p-2"><dt className="font-bold text-[#526359]">Latitude</dt><dd className="mt-1 font-mono">{indoorPlacement.position[0].toFixed(6)}</dd></div>
              <div className="rounded-lg bg-[#f7f9f8] p-2"><dt className="font-bold text-[#526359]">Longitude</dt><dd className="mt-1 font-mono">{indoorPlacement.position[1].toFixed(6)}</dd></div>
            </dl>}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-[#e6ece8] pt-3">
              <button type="button" className="rounded-full border border-[#dbe0e2] px-4 py-2 text-xs font-bold" disabled={indoor.saving} onClick={indoor.cancel}>Cancel</button>
              <button type="button" className="rounded-full bg-[#005931] px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!indoorPlacement.position || currentMapZoom < 20 || indoor.saving} onClick={() => { void saveIndoorLocationPosition(); }}>{indoor.saving ? "Saving Position…" : "Save Position"}</button>
            </div>
          </aside>
        )}

        {isOverviewZoom && mode !== "select" && (
          <div role="status" className="pointer-events-none absolute bottom-5 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-[#234333] shadow-lg">
            Zoom in to edit geometry
          </div>
        )}

        {networkBrowserOpen && (
          <NetworkBrowser
            pathways={currentPathways}
            nodes={currentNodes}
            buildings={allSessionBuildings}
            selected={networkBrowserSelection}
            onSelect={handleNetworkBrowserSelection}
            onDismiss={() => setNetworkBrowserOpen(false)}
            className=""
          />
        )}

        {selectionPopover && (
          <div
            role="dialog"
            aria-label="Choose overlapping object"
            data-anchor={selectionPopover.anchor.join(",")}
            className="absolute z-[1100] w-64 -translate-x-1/2 -translate-y-full rounded-2xl border border-[#dbe0e2] bg-white p-3 shadow-xl"
            style={{
              left: `${Math.max(8, Math.min(92, ((selectionPopover.anchor[1] - navigationBounds[0][1]) / (navigationBounds[1][1] - navigationBounds[0][1])) * 100))}%`,
              top: `${Math.max(8, Math.min(92, (1 - (selectionPopover.anchor[0] - navigationBounds[0][0]) / (navigationBounds[1][0] - navigationBounds[0][0])) * 100))}%`,
              maxHeight: "min(50vh, 420px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <p className="mb-2 text-xs font-bold text-[#191c1d]">Choose an object</p>
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

        <div className="map-glass-panel absolute left-4 top-4 z-[900] flex items-center gap-1 rounded-full p-1.5">
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
          onBrowseWalkingNetwork={browseWalkingNetwork}
          suspendedDrafts={workingSessionState.suspendedDrafts}
          onResumeDraft={requestDraftResume}
        />

        {pendingToolRequest && workingSessionState.activeDraft && (
          <ToolInterruptionDialog
            currentTool={workingSessionState.activeDraft.toolType}
            requestedTool={pendingToolRequest.toolType}
            onSuspend={() => finishInterruption("keep_draft")}
            onContinue={() => setPendingToolRequest(null)}
            onDiscard={() => finishInterruption("discard_geometry")}
          />
        )}

        <div className={`map-glass-panel absolute right-4 top-4 z-[900] w-72 rounded-[20px] p-2`}>
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
                  key={`${item.kind}:${item.id}`}
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

        {mode === "move" && pointTool.position && (
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
                Δ {moveDistanceMeters.toFixed(1)}m {pointTool.snapped && <em>(Snapped)</em>}
              </div>
            </div>
            <PointCoordinateInputs position={pointTool.position} onChange={pointTool.updateMovePosition} />
            {movingOutsideBoundary && (
              <div className="point-move-warning" role="alert">
                Position is outside the ISU Echague Campus Boundary. Drop and save are blocked.
              </div>
            )}
            {pointTool.dropRejected && (
              <div className="point-move-warning" role="alert">
                Point drop was blocked outside the ISU Echague Campus Boundary. The marker returned to its last valid position.
              </div>
            )}
            <div className="point-move-hud-footer">
              <span>{pointTool.dragging ? "Dragging · release to preview" : "Arrow keys 0.5m · Shift + Arrow 5.0m · Enter save · Esc cancel"}</span>
              <div>
                <button type="button" onClick={handleCancelMove}>Cancel</button>
                <button type="button" className="primary" disabled={movingOutsideBoundary || savingAction === "position"} onClick={handleSavePosition}>{savingAction === "position" ? "Saving Position…" : "Save Position"}</button>
              </div>
            </div>
          </section>
        )}

        {mode !== "select" && mode !== "move" && selected?.type !== "path_point"
          && !networkBrowserOpen && (
          <aside className="map-glass-panel absolute right-4 top-20 z-[901] w-80 max-h-[calc(100%-100px)] overflow-y-auto rounded-[28px] p-5">
            {error && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
                {error}
              </div>
            )}

            {mode === "area" ? (
              <BuildingToolPanel
                editor={buildingEditor}
                savingAction={savingAction}
                onSave={handleSaveBuilding}
                onOpenDetails={(buildingId) => {
                  setSelected({ type: "building", id: buildingId });
                  setOwnerModal("location");
                }}
              />
            ) : mode === "place" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Place on Map</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Place Route Node</h2>
                <div className="flex flex-col gap-1.5 my-2">
                  <label className="text-xs font-semibold text-[#3f4941]">Route Node type</label>
                  <select
                    aria-label="Route Node type"
                    value={pointTool.placingNodeType}
                    onChange={(e) => pointTool.setPlacingNodeType(e.target.value as "Entrance" | "Junction" | "Access Point")}
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
                    value={pointTool.placingNodeName}
                    onChange={(e) => pointTool.setPlacingNodeName(e.target.value)}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  />
                </div>
                <div className="flex flex-col gap-1.5 my-2">
                  <label className="text-xs font-semibold text-[#3f4941]">Building association</label>
                  <select
                    aria-label="Route Node association"
                    value={pointTool.placingAssociatedBuildingId ?? ""}
                    onChange={(e) => pointTool.setPlacingAssociatedBuildingId(e.target.value || null)}
                    disabled={pointTool.placingNodeType !== "Entrance"}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  >
                    <option value="">No Building association</option>
                    {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>
                      {building.name} ({building.code})
                    </option>)}
                  </select>
                  <span className="mt-1 block text-[10px] text-[#526359]">Saved with the Route Node Save action.</span>
                </div>
                <div className="my-2 text-xs text-[#3f4941]">
                  {pointTool.position
                    ? `Preview position: ${pointTool.position[0].toFixed(5)}, ${pointTool.position[1].toFixed(5)}`
                    : "Click the map to position this Route Node."}
                </div>
                <label className="block text-xs font-semibold text-[#3f4941]">Latitude
                  <input aria-label="Placement latitude" type="number" step="any" value={pointTool.position?.[0] ?? ""} onChange={(e) => pointTool.editPosition([Number(e.target.value), pointTool.position?.[1] ?? campusCenter[1]])} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                </label>
                <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
                  <input aria-label="Placement longitude" type="number" step="any" value={pointTool.position?.[1] ?? ""} onChange={(e) => pointTool.editPosition([pointTool.position?.[0] ?? campusCenter[0], Number(e.target.value)])} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
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
                    disabled={!pointTool.position || !pointTool.placingNodeName.trim() || savingAction === "route-node"}
                    onClick={handleSavePlacedNode}
                    className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    {savingAction === "route-node" ? "Saving Route Node…" : "Save Route Node"}
                  </button>
                </div>
              </div>
            ) : mode === "path" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Path Shape Points</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Calibrate Path Points</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="px-3 py-1.5 bg-[#005931] text-white rounded-full text-xs font-bold" onClick={startNewPathway}>＋ New Pathway</button>
                  <button
                    type="button"
                    className="px-3 py-1.5 border border-[#005931] bg-white text-[#005931] rounded-full text-xs font-bold"
                    onClick={() => { setMode("select"); setNetworkBrowserOpen(true); }}
                  >Browse Walking Network</button>
                </div>
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
                          <input aria-label="New Pathway name" placeholder={suggestedPathwayName(activePathway, currentNodes) || "Select two named Route Nodes"} value={pathwayDraft?.name ?? activePathway.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(activePathway); }} onBlur={() => adoptSuggestedPathwayName(activePathway)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
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
                          const found = directoryPathways.find((p) => p.id === e.target.value) || overlay.pathways.find((p) => p.id === e.target.value);
                          if (found) {
                            setPathPoints(found.pathPoints || []);
                          }
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
                        Select a Path Point to drag it, or click the map to add Path Points.{" "}
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
                        disabled={savingAction === "pathway"}
                        onClick={handleSavePathShape}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                      >
                        {savingAction === "pathway" ? "Saving Pathway…" : provisionalPathwayId === activePathway.id ? "Save Pathway" : "Update Pathway"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selectedBuildingView ? (
              <SelectedBuildingPanel
                view={selectedBuildingView}
                contentLocations={buildingContentLocations}
                onUpdateBuilding={updateBuilding}
                onEditFootprint={startSelectedBuildingGeometryEdit}
                onPlaceEntrance={() => {
                  pointTool.setPlacingNodeType("Entrance");
                  pointTool.setPlacingNodeName("");
                  pointTool.setPlacingAssociatedBuildingId(selectedBuildingView.associationId);
                  setMode("place");
                }}
                onClearSelection={() => setSelected(null)}
              />
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
                  <input aria-label="Route Node name" value={nodeFrame.frame?.name ?? selectedNode.name} onChange={(event) => nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node type
                  <select aria-label="Route Node type" value={nodeFrame.frame?.nodeType ?? selectedNode.nodeType} onChange={(event) => { const nodeType = event.target.value as RouteNode["nodeType"]; nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), nodeType, associatedPlaceId: nodeType === "Entrance" ? nodeFrame.frame?.associatedPlaceId ?? null : null }); }} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                    <option>Entrance</option><option>Junction</option><option>Access Point</option>
                  </select>
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Associated Building
                  <select aria-label="Associated Building" value={nodeFrame.frame?.associatedPlaceId ?? ""} onChange={(event) => nodeFrame.stage({ ...(nodeFrame.frame ?? selectedNode), associatedPlaceId: event.target.value || null })} disabled={(nodeFrame.frame?.nodeType ?? selectedNode.nodeType) !== "Entrance"} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs disabled:bg-[#f8f9fa]">
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
                  <input aria-label="Pathway name" placeholder={pathwayFrame && (suggestedPathwayName(pathwayFrame, currentNodes) || "Select two named Route Nodes")} value={pathwayFrame?.name ?? selectedPath.name} onKeyDown={(event) => { if (event.key === "Tab") adoptSuggestedPathwayName(pathwayFrame); }} onBlur={() => adoptSuggestedPathwayName(pathwayFrame)} onChange={(event) => setPathwayDraft((current) => current ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
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

        {inspectorModel && !networkBrowserOpen && (mode === "select" || selected?.type === "path_point" || selected?.type === "pathway") && (
          <>
            {error && <div className="absolute right-4 top-4 z-[902] max-w-sm rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 shadow" role="alert">{error}</div>}
            <InspectorCardHUD object={inspectorModel} onClose={() => setSelected(null)} />
          </>
        )}

        <MapLegend />
      </div>

      {buildingDetailsModalOpen && polygonClosed && buildingWorkflowMode === "create" && !editingBuildingId && (
        <BuildingDetailsModal
          draft={buildingForm}
          classification={buildingClassification}
          error={error}
          onChange={setBuildingForm}
          onClassificationChange={setBuildingClassification}
          onClose={closeBuildingDetailsModal}
          onSubmit={handleCreateBuilding}
          submitting={savingAction === "building"}
        />
      )}

      {ownerModal === "location" && locationModalEntity && (
        <LocationDetailsModal
          location={locationModalEntity}
          directory={currentLocations}
          allowedTypes={selectedBuilding ? ["Building", "Facility"] : undefined}
          onClose={() => setOwnerModal(null)}
          onPickIndoorLocationOnMap={selectedLocation && isIndoorLocation(selectedLocation)
            ? () => {
                const parent = currentBuildings.find((item) => item.id === selectedLocation.parentId || item.name === selectedLocation.building);
                setOwnerModal(null);
                if (parent) beginIndoorLocationPlacement(parent, selectedLocation);
                else setError("The parent Building footprint could not be found.");
              }
            : undefined}
          onSubmit={async (updated, photos) => {
            if (selectedBuilding) {
              const savedLocation = typeof services.locations.save === "function"
                ? await services.locations.save(updated, photos)
                : updated;
              const updatedBuilding: Building = {
                ...selectedBuilding,
                name: savedLocation.name,
                code: savedLocation.code,
                type: savedLocation.type === "Facility" ? "Facility" : "Building",
                status: savedLocation.status,
              };
              updateBuilding(updatedBuilding);
              updateLocation({ ...savedLocation, id: selectedBuildingLocation?.id ?? savedLocation.id });
              recordPropertyOperation("Locations", selectedBuilding.id, selectedBuilding, updatedBuilding, `Edit ${selectedBuilding.name} details`);
            } else if (selectedLocation) {
              const savedRecord = typeof services.locations.save === "function"
                ? await services.locations.save(updated, photos)
                : updated;
              const savedLocation = isIndoorLocation(updated) && updated.parentId && typeof services.locations.saveIndoorPosition === "function"
                ? await services.locations.saveIndoorPosition({
                    id: savedRecord.id,
                    buildingId: updated.parentId,
                    lat: updated.lat,
                    lng: updated.lng,
                  })
                : savedRecord;
              updateLocation(savedLocation);
              recordPropertyOperation("Locations", selectedLocation.id, selectedLocation, savedLocation, `Edit ${selectedLocation.name} details`);
            }
            await refreshMapData();
            setOwnerModal(null);
          }}
        />
      )}

      {ownerModal === "local_feature" && selectedLocalFeature && selectedLocalFeature.isEditable && (
        <LocalFeatureDetailsModal
          feature={selectedLocalFeature}
          onClose={() => setOwnerModal(null)}
          onSubmit={(updated) => {
            if (localFeatures.updateFeature(selectedLocalFeature, updated)) setOwnerModal(null);
          }}
        />
      )}

      {conversionDraft && <PathPointConversionModal
        draft={conversionDraft}
        parentName={activePathway?.name ?? conversionDraft.pathwayId}
        nodes={currentNodes}
        buildings={buildingAssociationOptions}
        error={error}
        saving={savingAction === "path-point-conversion"}
        onClose={() => { if (savingAction !== "path-point-conversion") setConversionDraft(null); }}
        onNodeChange={(change) => setConversionDraft((draft) => draft ? { ...draft, node: { ...draft.node, ...change } } : draft)}
        onPathwayChange={updateConversionPathway}
        onSave={savePathPointConversion}
      />}

      {indoor.chooserOpen && selectedBuilding && (
        <Modal
          title="Mark indoor location"
          subtitle={`Choose an existing indoor location in ${selectedBuilding.name}, then click its position inside the building footprint.`}
          size="md"
          variant="green"
          onClose={() => indoor.setChooserOpen(false)}
        >
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {buildingContentLocations.filter((location) => isIndoorLocation(location) && belongsToBuilding(location, selectedBuilding)).map((location) => {
              const positioned = location.lat !== null && location.lng !== null;
              return (
                <div key={location.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#dbe0e2] p-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm text-[#191c1d]">{location.name}</strong>
                    <span className="text-xs text-[#526359]">{location.floor ? `${location.floor} · ` : ""}{location.type} · {location.code}</span>
                    <span className="block text-[10px] text-[#526359]">{positioned ? "Marker placed" : "No map marker"}</span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button onClick={() => beginIndoorLocationPlacement(selectedBuilding, location)}>{positioned ? "Reposition" : "Place marker"}</Button>
                    <Button variant="subtle" disabled={!positioned} onClick={() => indoor.clear(selectedBuilding, location)}>Clear</Button>
                  </div>
                </div>
              );
            })}
            {!buildingContentLocations.some((location) => isIndoorLocation(location) && belongsToBuilding(location, selectedBuilding)) && (
              <p className="rounded-xl bg-[#f8faf9] p-4 text-sm text-[#526359]">This building has no Room, Office, Laboratory, or Restroom records yet. Use “Add indoor location” to create one first.</p>
            )}
          </div>
          {error && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          <div className="modal-actions"><Button variant="subtle" onClick={() => indoor.setChooserOpen(false)}>Close</Button></div>
        </Modal>
      )}

      {deleteConfirmation && (
        <Modal
          title={`Delete ${deleteConfirmation.kind === "building" ? "Building" : deleteConfirmation.kind === "route_node" ? "Route Node" : "Pathway"}?`}
          subtitle="This is a permanent hard delete and cannot be undone."
          size="sm"
          variant="danger"
          onClose={() => setDeleteConfirmation(null)}
        >
          <div className="space-y-2 text-xs text-[#3f4941]" role="document">
            <p><strong>{deleteConfirmation.name}</strong> will be permanently removed.</p>
            {deleteConfirmation.kind === "building" && <p className="text-red-700">The Building record and all associated Indoor Locations are permanently removed.</p>}
            {deleteConfirmation.kind === "route_node" && <><p><strong>Connected Pathways:</strong> {deleteConfirmation.impact?.connectedPathways.length ? deleteConfirmation.impact.connectedPathways.map((pathway) => pathway.name).join(", ") : "None"}</p><p className="text-red-700">Connected Pathways and their Path Points are removed by the existing delete cascade in the same transaction.</p></>}
            {deleteConfirmation.kind === "pathway" && <p className="text-red-700">This Pathway and its {deleteConfirmation.impact?.connectedPathways[0]?.pathPoints.length ?? 0} Path Point(s) are permanently removed.</p>}
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2 text-red-700">{error}</div>}
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDeleteConfirmation(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
            >
              Delete {deleteConfirmation.kind === "building" ? "Building" : deleteConfirmation.kind === "route_node" ? "Route Node" : "Pathway"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
