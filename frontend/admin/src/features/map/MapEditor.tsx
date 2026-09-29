import { useCallback, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import L from "leaflet";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { campusCenter } from "../../services/mockData";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { polygonFeatureAnchor } from "./mapEditing";
import { ToolInterruptionDialog, ToolRailDock } from "./ToolRailDock";
import { WorkingSessionManager } from "./WorkingSessionManager";
import { InspectorCardHUD } from "./InspectorCardHUD";
import { mapInspectorModel } from "./inspector/mapInspectorModel";
import { useEntranceLinking } from "./building/useEntranceLinking";
import { selectedBuildingViewFor } from "./building/selectedBuilding";
import { RouteNodeMovePanel } from "./routeNode/RouteNodeMovePanel";
import { NetworkBrowser, type NetworkBrowserSelection } from "./NetworkBrowser";
import { MapLegend } from "./MapLegend";
import type { EditorMode, ToolType } from "./types";
import { paddedCampusBounds, pointOnCampus } from "./campusBoundary";
import { createRouteNodeWorkflow } from "./routeNode/RouteNodeWorkflow";
import { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import { useRouteNodeFrame } from "./routeNode/useRouteNodeFrame";
import { usePathwayEditing } from "./pathway/usePathwayEditing";
import { PathwayCrossingWarning } from "./pathway/PathwayCrossingWarning";
import { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import { useLocalFeatureLayer } from "./localFeature/useLocalFeatureLayer";
import { useOutsideBoundaryCount, usePointSnapTargets } from "./session/mapDerivedData";
import { useMapRouteIntents, type MapRouteIntent } from "./session/useMapRouteIntents";
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
import { BasemapTileLayer, BasemapToggle, MapPageHeader, NonRoutableBuildingNotice, OutsideBoundaryNotice, OverviewZoomNotice } from "./MapChrome";
import { useCurrentLocalFeatures } from "./localFeature/useCurrentLocalFeatures";
import { useVisibleIndoorLocations } from "./indoorLocation/useVisibleIndoorLocations";
import { networkSelectionFocus } from "./selection/networkSelectionFocus";
import { routeNodeMoveStatus } from "./routeNode/routeNodeMoveStatus";
import { selectedMapObjects } from "./selection/selectedMapObjects";
import { MapModals, type OwnerModal } from "./MapModals";
import { MapLayers } from "./MapLayers";
import { ToolPanel } from "./ToolPanel";
import { MapController } from "./MapController";
import { indoorLocationParent, isPositionedLocation } from "./indoorLocation/indoorLocations";
import { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import { IndoorLocationPlacementPanel } from "./indoorLocation/IndoorLocationPlacementPanel";
import { useLocationDetailsSave } from "./location/useLocationDetailsSave";
import { activeToolForMode, enterToolMode, restoreToolMode } from "./session/toolModeTransitions";
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
  const [ownerModal, setOwnerModal] = useState<OwnerModal>(null);

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
    editingPathId,
    setEditingPathId,
    setProvisionalPathwayId,
    setPathPoints,
    setPathDraftDirty,
  } = pathway;
  const buildingEditor = useBuildingFootprintEditing({
    workingSession: workingSessionManager,
    overlay,
    saving,
    context: {
      sessionBuildings,
      associationOptions: buildingAssociationOptions,
      locations: currentLocations,
      nodes: currentNodes,
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
    nonRoutableBuildingId,
    setNonRoutableBuildingId,
    currentBuildings,
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
  const activeTool = activeToolForMode(mode);
  const editorState = { setMode, setSelected, setNetworkBrowserOpen };
  const toolSession = useToolSession({
    manager: workingSessionManager,
    journal: workingSessionJournal,
    key: workingSessionKey,
    activeTool,
    tools: { point: pointTool, polygon: buildingEditor, pathway },
    onToolActivated: (toolType, openedPathway) => enterToolMode(toolType, openedPathway, editorState),
    onDraftRestored: (toolType, records) => restoreToolMode(toolType, records, editorState),
    onOpenNetworkBrowser: () => setNetworkBrowserOpen(true),
  });
  const pointSnapTargets = usePointSnapTargets(
    { buildings: currentBuildings, nodes: currentNodes, pathways: currentPathways },
    { mode, movingId: pointTool.movingId },
  );
  const currentLocalFeatures = useCurrentLocalFeatures(localFeatureLayer, {
    buildings: currentBuildings,
    locations: currentLocations,
    nodes: currentNodes,
    pathways: currentPathways,
  });

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

  const visibleIndoorLocations = useVisibleIndoorLocations(buildingContentLocations, currentBuildings, currentMapZoom);
  const indoor = useIndoorLocationPlacement(
    overlay,
    { buildings: currentBuildings, locations: buildingContentLocations, zoom: currentMapZoom },
    setError,
  );
  const indoorPlacement = indoor.placement;

  const {
    location: selectedLocation,
    node: selectedNode,
    building: selectedBuilding,
    localFeature: selectedLocalFeature,
  } = selectedMapObjects(selected, {
    contentLocations: buildingContentLocations,
    nodes: currentNodes,
    buildings: currentBuildings,
    localFeatures: currentLocalFeatures,
  });
  const nodeFrame = useRouteNodeFrame(selectedNode, {
    workflow: routeNodeWorkflow,
    saving,
    context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
    onNodeSaved: overlay.putNode,
    refreshMapData,
    onError: setError,
  });
  const { movingObjectName, movingOutsideBoundary, moveDistanceMeters } = routeNodeMoveStatus(
    mode,
    pointTool,
    selectedNode,
    campusBoundary,
  );
  const selectedBuildingView = selectedBuildingViewFor(selectedBuilding, currentLocations, currentNodes);
  const selectedBuildingLocation = selectedBuildingView?.location;

  const applyRouteIntent = (intent: MapRouteIntent) => {
    switch (intent.type) {
      case "open-building-tool":
        toolSession.activateTool("polygon");
        break;
      case "locate-indoor-location": {
        const { location, parentBuilding, place } = intent;
        setMode("select");
        setFrameBounds(null);
        setError("");
        if (isPositionedLocation(location) && !place) {
          indoor.setPlacement(null);
          setSelected({ type: "location", id: location.id });
          flyTo([location.lat, location.lng], 20);
        } else {
          setSelected({ type: "location", id: location.id });
          indoor.startPlacement(parentBuilding, location);
          flyTo(polygonFeatureAnchor(parentBuilding.points), 20);
        }
        break;
      }
      case "locate-building": {
        const { building } = intent;
        // Locations may locate an existing record, but it must never hand off
        // into a standalone point-placement workflow. Footprint geometry stays
        // owned by Map Editor's Building Polygon tool.
        setMode("select");
        setSelected({ type: "building", id: building.id });
        if (building.points.length >= 3) {
          setFrameBounds([
            [Math.min(...building.points.map(([lat]) => lat)), Math.min(...building.points.map(([, lng]) => lng))],
            [Math.max(...building.points.map(([lat]) => lat)), Math.max(...building.points.map(([, lng]) => lng))],
          ]);
        }
        break;
      }
      case "locate-location": {
        const { location } = intent;
        setMode("select");
        setSelected({ type: "location", id: location.id });
        if (isPositionedLocation(location)) {
          setFrameBounds(null);
          flyTo([location.lat, location.lng]);
        }
        break;
      }
      case "open-pathway": {
        const { pathway: requested, sourceNode } = intent;
        setSelected({ type: "pathway", id: requested.id });
        pathway.setEditingPathId(requested.id);
        pathway.setPathwayDraft({ ...requested });
        pathway.setPathwayDraftOriginal({ ...requested });
        pathway.setPathPoints([...requested.pathPoints]);
        setMode("path");
        setError("");
        if (sourceNode) flyTo([sourceNode.lat, sourceNode.lng]);
        break;
      }
    }
  };

  useMapRouteIntents({
    route: { pathname: routeLocation.pathname, search: routeLocation.search, navigate },
    data: { map: data, directoryLocations, directoryPathways, overlayPathways: overlay.pathways },
    current: { buildings: currentBuildings, locations: buildingContentLocations, nodes: currentNodes },
    onIntent: applyRouteIntent,
    setError,
  });

  const applySelection = useCallback((type: MapSelectionType, id: string) => {
    localFeatures.setActionNotice("");
    if (type === "pathway") {
      const outcome = pathway.loadForSelection(id);
      if (outcome) setMode(outcome === "edit" ? "path" : "select");
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
    const focus = networkSelectionFocus(networkSelection, currentNodes, currentPathways);
    if (focus?.kind === "fly") {
      setFrameBounds(null);
      flyTo(focus.point);
    } else if (focus?.kind === "frame") {
      setFrameBounds(focus.bounds);
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

  const handleSaveBuilding = () => buildingEditor.saveBuilding();

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
      <MapPageHeader />

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
          <BasemapTileLayer basemap={basemap} displaysOsmOverlays={displaysOsmOverlays} />
          <MapController
            onMapClick={onMapClick}
            flyTarget={flyTarget}
            flyTargetZoom={flyTargetZoom}
            frameBounds={frameBounds}
            navigationBounds={navigationBounds}
            onViewportChange={handleViewportChange}
          />

          <MapLayers
            view={{ mode, selected, isOverviewZoom, campusBoundary }}
            visible={visible}
            current={{
              buildings: currentBuildings,
              nodes: currentNodes,
              contentLocations: buildingContentLocations,
              visibleIndoorLocations,
            }}
            editors={{ pathway, buildingEditor, pointTool, indoor }}
            move={{ snapTargets: pointSnapTargets, outsideBoundary: movingOutsideBoundary, distanceMeters: moveDistanceMeters }}
            actions={{
              onSelectCanvasObject: selectCanvasObject,
              onSelectObject: selectObject,
              onSelectIndoorLocation: (locationId) => {
                clearSelectionPopover();
                setSelected({ type: "location", id: locationId });
              },
              onClickNode: handleRouteNodeClick,
              onSelect: setSelected,
              onError: setError,
            }}
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

        {isOverviewZoom && mode !== "select" && <OverviewZoomNotice />}

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

        {outsideBoundaryCount > 0 && <OutsideBoundaryNotice count={outsideBoundaryCount} />}
        {pathwayCrossings[0] && <PathwayCrossingWarning onCreateJunction={createJunctionAtCrossing} />}
        {nonRoutableBuildingId && mode === "select" && <NonRoutableBuildingNotice onAddEntrance={startGuidedEntranceDraft} />}

        <BasemapToggle basemap={basemap} onChange={setBasemap} />

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
          <ToolPanel
            mode={mode}
            error={error}
            savingAction={savingAction}
            selection={{ building: selectedBuildingView, location: selectedLocation, node: selectedNode, path: selectedPath }}
            editors={{ buildingEditor, pointTool, pathway, nodeFrame }}
            data={{
              nodes: currentNodes,
              locations: currentLocations,
              contentLocations: buildingContentLocations,
              buildingAssociationOptions,
              directoryPathways,
              overlayPathways: overlay.pathways,
            }}
            actions={{
              onSaveBuilding: handleSaveBuilding,
              onOpenBuildingDetails: (buildingId) => {
                setSelected({ type: "building", id: buildingId });
                setOwnerModal("location");
              },
              onSavePlacedNode: handleSavePlacedNode,
              onCancelTool: () => selectTool("select"),
              onNewPathway: startNewPathway,
              onBrowseNetwork: () => { setMode("select"); setNetworkBrowserOpen(true); },
              onSavePathShape: handleSavePathShape,
              onUpdateBuilding: overlay.putBuilding,
              onEditBuildingFootprint: startSelectedBuildingGeometryEdit,
              onPlaceEntrance: (view) => {
                pointTool.setPlacingNodeType("Entrance");
                pointTool.setPlacingNodeName("");
                pointTool.setPlacingAssociatedBuildingId(view.associationId);
                setMode("place");
              },
              onUpdateLocation: overlay.putLocation,
              onMoveNode: handleStartMoveNode,
              onReshapePathway: reshapePathway,
              onClearSelection: () => setSelected(null),
            }}
          />
        )}

        {inspectorModel && !networkBrowserOpen && (mode === "select" || selected?.type === "path_point" || selected?.type === "pathway") && (
          <>
            {error && <div className="absolute right-4 top-4 z-[902] max-w-sm rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 shadow" role="alert">{error}</div>}
            <InspectorCardHUD object={inspectorModel} onClose={() => setSelected(null)} />
          </>
        )}

        <MapLegend />
      </div>

      <MapModals
        ownerModal={ownerModal}
        error={error}
        savingAction={savingAction}
        selection={{
          building: selectedBuilding,
          buildingLocation: selectedBuildingLocation,
          location: selectedLocation,
          localFeature: selectedLocalFeature,
        }}
        editors={{ buildingEditor, pathway, indoor, localFeatures }}
        data={{
          locations: currentLocations,
          contentLocations: buildingContentLocations,
          nodes: currentNodes,
          buildingAssociationOptions,
        }}
        deletion={{
          confirmation: deleteConfirmation,
          onConfirm: confirmDelete,
          onClose: () => setDeleteConfirmation(null),
        }}
        actions={{
          onCloseOwnerModal: () => setOwnerModal(null),
          onSubmitLocationDetails: async (updated, photos) => {
            await locationDetails.save(
              { building: selectedBuilding, buildingLocation: selectedBuildingLocation, location: selectedLocation },
              updated,
              photos,
            );
            setOwnerModal(null);
          },
          onPickIndoorLocationOnMap: (location) => {
            const parent = currentBuildings.find((item) => item.id === location.parentId || item.name === location.building);
            setOwnerModal(null);
            if (parent) beginIndoorLocationPlacement(parent, location);
            else setError("The parent Building footprint could not be found.");
          },
          onBeginIndoorPlacement: beginIndoorLocationPlacement,
          onSavePathPointConversion: savePathPointConversion,
        }}
      />
    </div>
  );
}
