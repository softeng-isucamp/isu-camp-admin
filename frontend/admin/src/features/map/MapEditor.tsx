import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { campusCenter } from "../../services/mockData";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { polygonFeatureAnchor } from "./mapEditing";
import { ToolInterruptionDialog, ToolRailDock } from "./ToolRailDock";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { InspectorCardHUD } from "./InspectorCardHUD";
import { LocalFeatureDetailsModal } from "./localFeature/LocalFeatureDetailsModal";
import { BuildingDetailsModal } from "./building/BuildingDetailsModal";
import { BuildingToolPanel } from "./building/BuildingToolPanel";
import { SelectedBuildingPanel } from "./building/SelectedBuildingPanel";
import { BuildingDraftLayer, BuildingFootprintLayer } from "./building/BuildingMapLayers";
import { mapInspectorModel } from "./inspector/mapInspectorModel";
import { useEntranceLinking } from "./building/useEntranceLinking";
import { selectedBuildingViewFor } from "./building/selectedBuilding";
import { RouteNodePlacePanel } from "./routeNode/RouteNodePlacePanel";
import { SelectedRouteNodePanel } from "./routeNode/SelectedRouteNodePanel";
import { RouteNodeMovePanel } from "./routeNode/RouteNodeMovePanel";
import { RouteNodeMarkersLayer, RouteNodeMoveLayer, RouteNodePlacementMarker } from "./routeNode/RouteNodeMapLayers";
import { NetworkBrowser, type NetworkBrowserSelection } from "./NetworkBrowser";
import { MapLegend } from "./MapLegend";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import { normalizeMapLayers } from "../../services/mapLayers";
import type { ActiveToolDraft, EditorMode, ToolType } from "./types";
import { paddedCampusBounds, pointOnCampus } from "./campusBoundary";
import { distanceInMeters } from "./pointInteractions";
import { createRouteNodeWorkflow } from "./routeNode/RouteNodeWorkflow";
import { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import { useRouteNodeFrame } from "./routeNode/useRouteNodeFrame";
import { usePathwayEditing } from "./pathway/usePathwayEditing";
import { PathPointConversionModal } from "./pathway/PathPointConversionModal";
import { PathwayToolPanel } from "./pathway/PathwayToolPanel";
import { SelectedPathwayPanel } from "./pathway/SelectedPathwayPanel";
import { PathwayDraftLayer, PathwaysLayer } from "./pathway/PathwayMapLayers";
import { PathwayCrossingWarning } from "./pathway/PathwayCrossingWarning";
import { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import { useLocalFeatureLayer } from "./localFeature/useLocalFeatureLayer";
import { useOutsideBoundaryCount, usePointSnapTargets } from "./session/mapDerivedData";
import { useMapRouteIntents } from "./session/useMapRouteIntents";
import { useMapData } from "./session/useMapData";
import { useMapOverlay } from "./session/useMapOverlay";
import { useSessionMapData } from "./session/useSessionMapData";
import { useSavingAction } from "./session/useSavingAction";
import { useToolSession } from "./session/useToolSession";
import { useLocalFeatureEditing } from "./localFeature/useLocalFeatureEditing";
import { createWorkingSessionJournal, type WorkingSessionKey } from "./WorkingSessionJournal";
import { useMapSelection, type MapSelection, type MapSelectionType } from "./selection/useMapSelection";
import { useMapSearch } from "./selection/useMapSearch";
import { useVisibleMapObjects } from "./selection/useVisibleMapObjects";
import { MapSearchBox } from "./selection/MapSearchBox";
import { SelectionPopover } from "./selection/SelectionPopover";
import { MapController } from "./MapController";
import { belongsToBuilding, indoorLocationParent, isIndoorLocation } from "./indoorLocation/indoorLocations";
import { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import { IndoorLocationMapLayers } from "./indoorLocation/IndoorLocationMapLayers";
import { IndoorLocationPlacementPanel } from "./indoorLocation/IndoorLocationPlacementPanel";
import { IndoorLocationChooserModal } from "./indoorLocation/IndoorLocationChooserModal";
import { LocationMapLayer } from "./location/LocationMapLayer";
import { SelectedLocationPanel } from "./location/SelectedLocationPanel";
import { locationDetailsEntity } from "./location/locationDetailsEntity";
import { useLocationDetailsSave } from "./location/useLocationDetailsSave";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import { useDeleteConfirmation } from "./session/useDeleteConfirmation";
import { useEscapeShortcut, usePointMoveKeys } from "./session/useMapKeyboard";
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

  const {
    data,
    locationDirectory,
    directoryLocations,
    directoryNodes,
    directoryPathways,
    campusBoundary,
    directoryMapLayers,
  } = useMapData();

  const overlay = useMapOverlay(data?.buildings);
  const [ownerModal, setOwnerModal] = useState<"location" | "local_feature" | null>(null);

  const [mode, setMode] = useState<EditorMode>("select");
  const [selected, setSelected] = useState<MapSelection | null>(null);

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

  const localFeatureLayer = useLocalFeatureLayer(directoryMapLayers.featureLinks);
  const currentFeatureLinks = localFeatureLayer.currentFeatureLinks;
  const localFeatures = useLocalFeatureEditing({
    workingSession: workingSessionManager,
    layer: localFeatureLayer,
    onError: setError,
  });
  const {
    currentLocations,
    buildingContentLocations,
    currentNodes,
    sessionBuildings,
    allSessionBuildings,
    buildingAssociationOptions,
  } = useSessionMapData(data, locationDirectory, overlay);
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
    editingPathId,
    setEditingPathId,
    setPathwayDraft,
    setPathwayDraftOriginal,
    setProvisionalPathwayId,
    setPathPoints,
    setSelectedPathPointIndex,
    setPathDraftDirty,
    conversionDraft,
    setConversionDraft,
    updateConversionPathway,
  } = pathway;
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
    editorContext: { mode, selected },
  });
  const activeTool: ToolType = mode === "place" || mode === "move"
    ? "point"
    : mode === "area"
      ? "polygon"
      : mode === "path"
        ? "pathway"
        : mode;
  const toolSession = useToolSession({
    manager: workingSessionManager,
    journal: workingSessionJournal,
    key: workingSessionKey,
    activeTool,
    tools: { point: pointTool, polygon: buildingEditor, pathway },
    onToolActivated: (toolType, openedPathway) => {
      const activationHandlers: Record<ToolType, () => void> = {
        select: () => setMode("select"),
        point: () => {
          setMode("place");
          setSelected(null);
        },
        polygon: () => setMode("area"),
        pathway: () => {
          setMode("path");
          setNetworkBrowserOpen(false);
          if (openedPathway) setSelected({ type: "pathway", id: openedPathway.id });
        },
      };
      activationHandlers[toolType]();
    },
    onDraftRestored: (toolType, records) => {
      const restoreHandlers: Record<ActiveToolDraft["toolType"], () => void> = {
        point: () => {
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
        polygon: () => setMode("area"),
        pathway: () => setMode("path"),
      };
      restoreHandlers[toolType]();
    },
    onOpenNetworkBrowser: () => setNetworkBrowserOpen(true),
  });
  const pointSnapTargets = usePointSnapTargets(
    { buildings: currentBuildings, nodes: currentNodes, pathways: currentPathways },
    { mode, movingId: pointTool.movingId },
  );
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
  const outsideBoundaryCount = useOutsideBoundaryCount(
    { buildings: currentBuildings, locations: currentLocations, nodes: currentNodes, pathways: currentPathways },
    campusBoundary,
  );

  const visible = useVisibleMapObjects(
    { buildings: currentBuildings, locations: currentLocations, nodes: currentNodes, pathways: currentPathways },
    mode,
    selected,
    currentMapBounds,
  );

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
  const selectedBuildingView = selectedBuildingViewFor(selectedBuilding, currentLocations, currentNodes, currentFeatureLinks);
  const selectedBuildingLocation = selectedBuildingView?.location;

  useMapRouteIntents({
    route: { pathname: routeLocation.pathname, search: routeLocation.search, navigate },
    data: { loaded: Boolean(data), directoryLocations, directoryPathways, overlayPathways: overlay.pathways },
    current: { buildings: currentBuildings, locations: buildingContentLocations, nodes: currentNodes },
    indoor,
    pathway,
    toolSession,
    view: { setMode, setSelected, setError, setFrameBounds, flyTo },
  });

  const applySelection = useCallback((type: MapSelectionType, id: string) => {
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
  }, [currentNodes, currentPathways]);
  const { popover: selectionPopover, clearPopover: clearSelectionPopover, selectObject, selectCanvasObject } = useMapSelection(
    mode,
    setSelected,
    { locations: currentLocations, nodes: currentNodes, pathways: currentPathways, buildings: currentBuildings },
    applySelection,
  );

  const { search, setSearch, results, selectResult: handleSearchResultClick } = useMapSearch(
    {
      directoryLocations,
      directoryNodes,
      overlayLocations: overlay.locations,
      overlayNodes: overlay.nodes,
      pathways: currentPathways,
    },
    selectObject,
    flyTo,
  );

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
      clearSelectionPopover();
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
    navigate(`/locations?add=indoor&parentId=${encodeURIComponent(building.id)}`, {
      state: { indoorLocationParent: indoorLocationParent(building, currentLocations) },
    });
  };

  const entranceLinking = useEntranceLinking({
    workflow: routeNodeWorkflow,
    context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
    onNodeSaved: overlay.putNode,
    refreshMapData,
    onError: setError,
    onLinked: (buildingId) => setSelected({ type: "building", id: buildingId }),
  });

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

  const reshapePathway = (path: Pathway) => {
    setEditingPathId(path.id);
    setPathPoints(path.pathPoints || []);
    setMode("path");
  };

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
  const updateBuilding = overlay.putBuilding;






  const selectTool = (toolType: ToolType) => {
    if (toolType === activeTool) {
      if (toolType === "pathway") setNetworkBrowserOpen(false);
      return;
    }
    toolSession.requestTool({ toolType });
  };

  const browseWalkingNetwork = () => toolSession.requestTool({ toolType: "select", openNetworkBrowser: true });

  usePointMoveKeys({
    mode,
    pointTool,
    campusBoundary,
    onCancel: handleCancelMove,
    onSave: handleSavePosition,
  });
  useEscapeShortcut({
    mode,
    activeTool,
    toolSession,
    workingSession: workingSessionManager,
    onClearSelection: () => setSelected(null),
  });

  const workingSessionState = toolSession.state;
  const { deleteConfirmation, setDeleteConfirmation, confirmDelete } = useDeleteConfirmation({
    overlay,
    refreshMapData,
    onError: setError,
    onDeleted: () => setSelected(null),
  });

  const locationDetails = useLocationDetailsSave({
    workingSession: workingSessionManager,
    overlay,
    refreshMapData,
  });
  const locationModalEntity = locationDetailsEntity(selectedLocation, selectedBuilding, selectedBuildingLocation);

  const startSelectedBuildingGeometryEdit = () => {
    if (!selectedBuilding) return;
    initializeBuildingFootprintEdit(selectedBuilding, "reshape");
  };

  const handleRouteNodeClick = (node: RouteNode) => {
    if (mode === "path" && !editingPathId) {
      const nextSelection = pathway.handleNodeClick(node, isOverviewZoom);
      if (nextSelection) setSelected(nextSelection);
      return;
    }
    selectCanvasObject("node", node.id, [node.lat, node.lng]);
  };

  const inspectorModel = mapInspectorModel({
    selected,
    selection: {
      building: selectedBuildingView,
      location: selectedLocation,
      node: selectedNode,
      path: selectedPath,
      localFeature: selectedLocalFeature,
    },
    current: {
      buildings: currentBuildings,
      locations: currentLocations,
      nodes: currentNodes,
      pathways: currentPathways,
      contentLocations: buildingContentLocations,
    },
    editors: { pathway, nodeFrame, localFeatures, routeNodeWorkflow },
    campusBoundary,
    buildingAssociationOptions,
    savingAction,
    linkingEntrance: entranceLinking.linking,
    actions: {
      building: (view) => ({
        onReshape: startSelectedBuildingGeometryEdit,
        onEditDetails: () => setOwnerModal("location"),
        onAddIndoorLocation: () => openIndoorLocationHandoff(view.building),
        onMarkIndoorLocation: () => { setError(""); indoor.setChooserOpen(true); },
        onAddEntrance: () => {
          pointTool.beginEntrancePlacement(`${view.building.name} Entrance`, view.associationId);
          setMode("place");
        },
        onToggleLinkEntrance: () => entranceLinking.setLinking((open) => !open),
        onLinkExistingEntrance: () => entranceLinking.setLinking(true),
        onLinkEntrance: (node) => entranceLinking.linkExistingEntrance(view, node),
        onDelete: () => setDeleteConfirmation({ kind: "building", id: view.building.id, name: view.building.name }),
      }),
      onEditLocationDetails: () => setOwnerModal("location"),
      onEditLocalFeatureDetails: () => setOwnerModal("local_feature"),
      onError: setError,
      onNodeUpdated: overlay.putNode,
      onMoveNode: handleStartMoveNode,
      onSelect: setSelected,
      onDelete: setDeleteConfirmation,
      onApplyPathway: applyPathwayFrame,
      onCancelPathway: cancelPathwayFrame,
      onReshapePathway: reshapePathway,
      onStartPathPointConversion: startPathPointConversion,
    },
  });

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
            buildings={visible.buildings}
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

          <PathwaysLayer
            pathway={pathway}
            pathways={visible.pathways}
            nodes={currentNodes}
            mode={mode}
            selectedPathId={selected?.type === "pathway" ? selected.id : null}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onSelectPathway={(pathwayId, anchor) => selectCanvasObject("pathway", pathwayId, anchor)}
          />

          <LocationMapLayer
            locations={visible.locations}
            selectedLocationId={selected?.type === "location" ? selected.id : null}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onSelectLocation={(locationId, anchor) => selectCanvasObject("location", locationId, anchor)}
          />

          <IndoorLocationMapLayers
            indoor={indoor}
            visibleLocations={visibleIndoorLocations}
            contentLocations={buildingContentLocations}
            buildings={currentBuildings}
            selectedLocationId={selected?.type === "location" ? selected.id : null}
            onSelectLocation={(locationId) => {
              clearSelectionPopover();
              setSelected({ type: "location", id: locationId });
            }}
          />

          <RouteNodeMarkersLayer
            nodes={visible.nodes}
            mode={mode}
            movingId={pointTool.movingId}
            selectedNodeId={selected?.type === "node" ? selected.id : null}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onClickNode={handleRouteNodeClick}
          />

          <PathwayDraftLayer
            pathway={pathway}
            nodes={currentNodes}
            mode={mode}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onSelect={setSelected}
            onError={setError}
          />

          <BuildingDraftLayer
            editor={buildingEditor}
            mode={mode}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onError={setError}
          />

          <RouteNodeMoveLayer
            pointTool={pointTool}
            mode={mode}
            snapTargets={pointSnapTargets}
            campusBoundary={campusBoundary}
            outsideBoundary={movingOutsideBoundary}
            distanceMeters={moveDistanceMeters}
            isOverviewZoom={isOverviewZoom}
          />

          <RouteNodePlacementMarker
            pointTool={pointTool}
            mode={mode}
            campusBoundary={campusBoundary}
            isOverviewZoom={isOverviewZoom}
            onError={setError}
          />
        </MapContainer>

        {indoorPlacement && (
          <IndoorLocationPlacementPanel
            indoor={indoor}
            contentLocations={buildingContentLocations}
            buildings={currentBuildings}
            zoom={currentMapZoom}
            error={error}
            onSave={() => { void saveIndoorLocationPosition(); }}
          />
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
          <SelectionPopover popover={selectionPopover} navigationBounds={navigationBounds} onSelect={selectObject} />
        )}

        {outsideBoundaryCount > 0 && (
          <div className="absolute bottom-4 right-4 z-[900] max-w-xs rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-xs text-amber-900 shadow-lg" role="status">
            <strong>{outsideBoundaryCount} existing editable campus feature{outsideBoundaryCount === 1 ? "" : "s"} outside campus boundary.</strong>
            <div className="mt-1">Legacy data is retained. Move or edit it back inside the boundary before saving changes.</div>
          </div>
        )}
        {pathwayCrossings[0] && <PathwayCrossingWarning onCreateJunction={createJunctionAtCrossing} />}
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
          onResumeDraft={toolSession.requestDraftResume}
        />

        {toolSession.pendingToolRequest && workingSessionState.activeDraft && (
          <ToolInterruptionDialog
            currentTool={workingSessionState.activeDraft.toolType}
            requestedTool={toolSession.pendingToolRequest.toolType}
            onSuspend={() => toolSession.finishInterruption("keep_draft")}
            onContinue={toolSession.cancelInterruption}
            onDiscard={() => toolSession.finishInterruption("discard_geometry")}
          />
        )}

        <MapSearchBox search={search} results={results} onSearchChange={setSearch} onSelectResult={handleSearchResultClick} />

        <RouteNodeMovePanel
          pointTool={pointTool}
          mode={mode}
          movingObjectName={movingObjectName}
          movingOutsideBoundary={movingOutsideBoundary}
          moveDistanceMeters={moveDistanceMeters}
          savingAction={savingAction}
          onCancel={handleCancelMove}
          onSave={handleSavePosition}
        />

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
              <RouteNodePlacePanel
                pointTool={pointTool}
                buildingAssociationOptions={buildingAssociationOptions}
                campusCenter={campusCenter}
                savingAction={savingAction}
                onSave={handleSavePlacedNode}
                onCancel={() => selectTool("select")}
              />
            ) : mode === "path" ? (
              <PathwayToolPanel
                pathway={pathway}
                nodes={currentNodes}
                directoryPathways={directoryPathways}
                overlayPathways={overlay.pathways}
                savingAction={savingAction}
                onNewPathway={startNewPathway}
                onBrowseNetwork={() => { setMode("select"); setNetworkBrowserOpen(true); }}
                onSave={handleSavePathShape}
                onCancel={() => selectTool("select")}
              />
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
              <SelectedLocationPanel
                location={selectedLocation}
                onUpdate={updateLocation}
                onClearSelection={() => setSelected(null)}
              />
            ) : selectedNode ? (
              <SelectedRouteNodePanel
                node={selectedNode}
                frame={nodeFrame}
                locations={currentLocations}
                pathways={directoryPathways}
                buildingAssociationOptions={buildingAssociationOptions}
                onMove={handleStartMoveNode}
                onClearSelection={() => setSelected(null)}
              />
            ) : selectedPath ? (
              <SelectedPathwayPanel
                pathway={pathway}
                path={selectedPath}
                nodes={currentNodes}
                onUpdate={pathway.update}
                onReshape={reshapePathway}
                onClearSelection={() => setSelected(null)}
              />
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
            await locationDetails.save(
              { building: selectedBuilding, buildingLocation: selectedBuildingLocation, location: selectedLocation },
              updated,
              photos,
            );
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
        <IndoorLocationChooserModal
          indoor={indoor}
          building={selectedBuilding}
          contentLocations={buildingContentLocations}
          error={error}
          onBeginPlacement={beginIndoorLocationPlacement}
        />
      )}

      {deleteConfirmation && (
        <DeleteConfirmationModal
          confirmation={deleteConfirmation}
          error={error}
          onConfirm={confirmDelete}
          onClose={() => setDeleteConfirmation(null)}
        />
      )}
    </div>
  );
}
