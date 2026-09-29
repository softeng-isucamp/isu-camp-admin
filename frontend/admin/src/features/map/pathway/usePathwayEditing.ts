import { useMemo, useState } from "react";
import { services } from "../../../services/api";
import type { Building, Pathway, RouteNode } from "../../../types";
import type { MapPoint } from "../campusBoundary";
import { overlayChanges, pathwayWithSuggestedName, polygonFeatureAnchor, suggestedPathwayName, validatePathwayDraft } from "../mapEditing";
import { distanceInMeters } from "../pointInteractions";
import type { MapSelection } from "../selection/useMapSelection";
import type { MapOverlay } from "../session/useMapOverlay";
import type { SavingAction } from "../session/useSavingAction";
import type { ActiveToolDraft } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";
import type { PathPointConversionDraft } from "./PathPointConversionModal";
import { createRoutableCrossing } from "./pathwayCommands";
import { isPathwayDraft } from "./pathwayDrafts";
import { findPathwayCrossings, insertPathPointAtSegmentMidpoint, pathwayConnectionError } from "./pathwayTopology";
import { createPathwayWorkflow } from "./PathwayWorkflow";

export interface PathwayNetwork {
  directoryPathways: Pathway[];
  directoryNodes: RouteNode[];
  nodes: RouteNode[];
  campusBoundary: MapPoint[];
}

interface UsePathwayEditingOptions {
  workingSession: WorkingSessionManager;
  overlay: MapOverlay;
  saving: SavingAction;
  network: PathwayNetwork;
  selectedPathId: string | null;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
}

/**
 * Pathway editing: the reshape draft (path points, provisional pathway,
 * endpoint selection), staged metadata in the pathway frame, Path Point
 * conversion, and crossing Junctions. The caller owns editor mode and
 * selection and reacts to the commands' results.
 */
export function usePathwayEditing({
  workingSession,
  overlay,
  saving,
  network,
  selectedPathId,
  refreshMapData,
  onError,
}: UsePathwayEditingOptions) {
  const { directoryPathways, directoryNodes, nodes: currentNodes, campusBoundary } = network;
  const { beginSaving, endSaving } = saving;
  const setError = onError;

  const pathwayWorkflow = useMemo(() => createPathwayWorkflow({
    adapter: services.map,
    workingSession,
  }), [workingSession]);

  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [conversionDraft, setConversionDraft] = useState<PathPointConversionDraft | null>(null);
  const [pathPointDragPreview, setPathPointDragPreview] = useState<{
    index: number;
    point: [number, number];
  } | null>(null);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [pathwayDraft, setPathwayDraft] = useState<Pathway | null>(null);
  const [pathwayDraftOriginal, setPathwayDraftOriginal] = useState<Pathway | null>(null);
  const [provisionalPathwayId, setProvisionalPathwayId] = useState<string | null>(null);
  const [pathStartNodeId, setPathStartNodeId] = useState<string | null>(null);
  const [pathDraftDirty, setPathDraftDirty] = useState(false);

  const currentPathways = useMemo(() => {
    const merged = overlayChanges(directoryPathways, overlay.pathways);
    const visible = merged.filter((item) => !overlay.deletedPathwayIds.includes(item.id));
    return editingPathId ? visible.map((item) => item.id === editingPathId
      ? { ...item, ...(pathwayDraft?.id === editingPathId ? pathwayDraft : {}), pathPoints }
      : item) : visible;
  }, [overlay.deletedPathwayIds, directoryPathways, editingPathId, overlay.pathways, pathwayDraft, pathPoints]);
  const pathwayCrossings = useMemo(
    () => findPathwayCrossings(currentPathways, currentNodes),
    [currentNodes, currentPathways],
  );
  const selectedPath = selectedPathId ? currentPathways.find((item) => item.id === selectedPathId) : undefined;
  const activePathway = currentPathways.find((p) => p.id === editingPathId);

  const adoptSuggestedPathwayName = (pathway: Pathway | null | undefined) => {
    if (!pathway) return;
    const suggestion = suggestedPathwayName(pathway, currentNodes);
    if (!suggestion) return;
    setPathwayDraft((current) => current && !current.name.trim() ? { ...current, name: suggestion } : current);
  };

  const startNew = () => {
    setEditingPathId(null);
    setPathwayDraft(null);
    setPathwayDraftOriginal(null);
    setProvisionalPathwayId(null);
    setPathStartNodeId(null);
    setPathPoints([]);
    setPathDraftDirty(false);
  };

  /**
   * A Route Node click while drawing a new pathway: the first node starts it,
   * the second creates a provisional pathway. Returns the selection to adopt,
   * or null when the click was rejected.
   */
  const handleNodeClick = (node: RouteNode, isOverviewZoom: boolean): MapSelection | null => {
    if (isOverviewZoom) {
      setError("Zoom in to edit map geometry.");
      return null;
    }
    if (node.status !== undefined && node.status !== "Active") {
      setError("Pathways can only use active Route Nodes.");
      return null;
    }
    if (!pathStartNodeId) {
      setPathStartNodeId(node.id);
      setPathDraftDirty(true);
      return { type: "node", id: node.id };
    }
    const source = currentNodes.find((candidate) => candidate.id === pathStartNodeId);
    if (!source || (source.status !== undefined && source.status !== "Active")) {
      setError("Pathways can only use active Route Nodes.");
      return null;
    }
    const connectionError = pathwayConnectionError(pathStartNodeId, node.id, currentPathways);
    if (connectionError) {
      setError(connectionError);
      return null;
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
    setPathDraftDirty(true);
    setError("");
    return { type: "pathway", id: newPath.id };
  };

  /** Stages an edited pathway in the overlay unless it would duplicate a connection. */
  const update = (updated: Pathway): boolean => {
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

  /**
   * Loads a selected pathway into the draft. Legacy Open records retain the
   * old edit-on-selection behavior for compatibility; canonical Active
   * records open in inspection first, and editing requires the explicit
   * Edit/Reshape action. Returns which of the two applied, or null when the
   * pathway is unknown.
   */
  const loadForSelection = (id: string): "edit" | "inspect" | null => {
    const path = currentPathways.find((p) => p.id === id);
    if (!path) return null;
    setPathwayDraft({ ...path });
    setPathwayDraftOriginal({ ...path });
    const outcome = path.status === "Open" ? "edit" : "inspect";
    if (outcome === "edit") {
      setEditingPathId(path.id);
      setPathPoints(path.pathPoints || []);
    } else {
      setEditingPathId(null);
      setPathPoints([]);
    }
    setSelectedPathPointIndex(null);
    return outcome;
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

  const saveShape = async (): Promise<boolean> => {
    if (!editingPathId) return false;
    if (!beginSaving("pathway")) return false;
    const target = overlay.pathways.find((pathway) => pathway.id === editingPathId) || directoryPathways.find((pathway) => pathway.id === editingPathId);
    if (target) {
      const draft = {
        ...(pathwayDraft?.id === target.id ? pathwayDraft : target),
        pathPoints,
      };
      const result = provisionalPathwayId === target.id
        ? await pathwayWorkflow.finalize({
            kind: "create",
            draft,
            context: { nodes: currentNodes, existingPathways: currentPathways, campusBoundary },
            description: `Create ${draft.name}`,
          })
        : await pathwayWorkflow.finalize({
            kind: "update",
            before: target,
            after: draft,
            context: { nodes: currentNodes, existingPathways: currentPathways, campusBoundary },
            description: `Reshape ${target.name}`,
          });
      if (!result.ok) {
        setError(result.message);
        endSaving();
        return false;
      }
      const persistedPath = result.pathway;
      overlay.putPathways([persistedPath], [editingPathId, target.id]);
      setPathwayDraft({ ...persistedPath });
      setPathwayDraftOriginal({ ...persistedPath });
      try {
        await refreshMapData();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Pathway was saved, but the map could not refresh. Retry the refresh before saving again.");
        endSaving();
        return false;
      }
      const src = directoryNodes.find((n) => n.id === target.sourceNodeId);
      const dst = directoryNodes.find((n) => n.id === target.destinationNodeId);
      overlay.ensureNodes([src, dst].filter((node): node is RouteNode => Boolean(node)));
    }
    endSaving();
    return true;
  };

  const createJunctionAtCrossing = async (onCreated: (junction: RouteNode) => void) => {
    const crossing = pathwayCrossings[0];
    if (!crossing) return;
    const pathwayA = currentPathways.find((pathway) => pathway.id === crossing.pathwayAId);
    const pathwayB = currentPathways.find((pathway) => pathway.id === crossing.pathwayBId);
    if (!pathwayA || !pathwayB) return;
    if (!beginSaving("route-node")) return;
    const provisional = createRoutableCrossing(pathwayA, pathwayB, currentNodes, crossing.point, `pending-junction-${Date.now()}`);
    try {
      const junction = await services.map.createRouteNode({
        name: provisional.junction.name,
        nodeType: "Junction",
        associatedPlaceId: null,
        lat: provisional.junction.lat,
        lng: provisional.junction.lng,
      });
      const crossingChange = createRoutableCrossing(pathwayA, pathwayB, currentNodes, crossing.point, junction.id);
      overlay.putNode(junction);
      overlay.putPathways([...crossingChange.closedPathways, ...crossingChange.replacementPathways]);
      workingSession.executeBatch(
        `Create Junction and split ${pathwayA.name} with ${pathwayB.name}`,
        "Walking Network",
        junction.id,
        crossingChange.operations,
      );
      setEditingPathId(null);
      setPathPoints([]);
      onCreated(junction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the Junction Route Node.");
    } finally {
      endSaving();
    }
  };

  const pathwayFrame = selectedPath && pathwayDraft?.id === selectedPath.id
    ? { ...pathwayDraft, pathPoints: editingPathId === selectedPath.id ? pathPoints : pathwayDraft.pathPoints }
    : selectedPath ?? activePathway;
  const namedPathwayFrame = pathwayFrame ? pathwayWithSuggestedName(pathwayFrame, currentNodes) : null;
  const pathwayFrameIssues = namedPathwayFrame
    ? validatePathwayDraft(namedPathwayFrame, currentNodes, campusBoundary, {
      existingPathways: currentPathways.filter((pathway) => pathway.id !== namedPathwayFrame.id),
      requireActiveEndpoints: true,
    })
    : [];
  const pathwayFrameDirty = Boolean(
    namedPathwayFrame && (
      (pathwayDraftOriginal && JSON.stringify(namedPathwayFrame) !== JSON.stringify(pathwayDraftOriginal))
      || (!pathwayDraftOriginal && provisionalPathwayId === namedPathwayFrame.id)
    ),
  );
  const startConversion = (currentBuildings: readonly Building[]) => {
    if (!activePathway || selectedPathPointIndex === null || !pathPoints[selectedPathPointIndex] || pathwayFrameDirty || pathDraftDirty) return;
    const index = selectedPathPointIndex;
    const point = pathPoints[index];
    const existingNode = currentNodes.find((node) => node.status !== "Inactive"
      && Math.abs(node.lat - point[0]) <= 1e-8 && Math.abs(node.lng - point[1]) <= 1e-8);
    const nearestBuilding = currentBuildings
      .filter((building) => building.points.length >= 3)
      .map((building) => ({ building, distance: distanceInMeters(point, polygonFeatureAnchor(building.points)) }))
      .sort((left, right) => left.distance - right.distance)[0]?.building;
    const campusReference = nearestBuilding?.name
      ?? currentNodes.find((node) => node.id === activePathway.sourceNodeId)?.name
      ?? currentNodes.find((node) => node.id === activePathway.destinationNodeId)?.name;
    const nodeId = existingNode?.id ?? "pending-conversion-node";
    const segment = (suffix: "A" | "B", pathPoints: [number, number][], sourceNodeId: string, destinationNodeId: string): Pathway => ({
      ...activePathway,
      id: `${activePathway.id}-${suffix.toLowerCase()}`,
      name: `${activePathway.name} ${suffix}`,
      sourceNodeId,
      destinationNodeId,
      pathPoints,
      allowedModes: activePathway.allowedModes?.length ? activePathway.allowedModes : ["Walking"],
      status: activePathway.status === "Open" || activePathway.status === "Active" ? activePathway.status : "Active",
    });
    setConversionDraft({
      pathwayId: activePathway.id,
      index,
      point: [...point],
      existingNodeId: existingNode?.id ?? null,
      node: { name: campusReference ? `Junction near ${campusReference}` : "", nodeType: "Junction", lat: point[0], lng: point[1], status: "Active", associatedPlaceId: null },
      pathways: [
        segment("A", pathPoints.slice(0, index), activePathway.sourceNodeId, nodeId),
        segment("B", pathPoints.slice(index + 1), nodeId, activePathway.destinationNodeId),
      ],
    });
    setError("");
  };

  const updateConversionPathway = (index: 0 | 1, change: Partial<Pathway>) => setConversionDraft((draft) => {
    if (!draft) return draft;
    const pathways: [Pathway, Pathway] = [...draft.pathways];
    pathways[index] = { ...pathways[index], ...change };
    return { ...draft, pathways };
  });

  const saveConversion = async (onConverted: (nodeId: string) => void) => {
    if (!conversionDraft || !beginSaving("path-point-conversion")) return;
    try {
      const result = await services.map.convertPathPoint({
        pathwayId: conversionDraft.pathwayId,
        sequenceNo: conversionDraft.index + 1,
        point: conversionDraft.point,
        node: conversionDraft.existingNodeId ? null : conversionDraft.node,
        existingNodeId: conversionDraft.existingNodeId,
        pathways: conversionDraft.pathways,
      });
      const original = currentPathways.find((item) => item.id === conversionDraft.pathwayId);
      if (original) overlay.putPathways([{ ...original, status: "Closed" }, ...result.pathways]);
      if (!conversionDraft.existingNodeId) overlay.putNode(result.node);
      setConversionDraft(null);
      setEditingPathId(null);
      setPathwayDraft(null);
      setPathwayDraftOriginal(null);
      setSelectedPathPointIndex(null);
      setPathDraftDirty(false);
      onConverted(result.node.id);
      setError("");
      await refreshMapData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not convert Path Point.");
    } finally {
      endSaving();
    }
  };

  const applyFrame = async (): Promise<boolean> => {
    if (!namedPathwayFrame || pathwayFrameIssues.length > 0) {
      if (pathwayFrameIssues[0]) setError(pathwayFrameIssues[0].message);
      return false;
    }
    if (!pathwayFrameDirty) return false;
    if (!pathwayDraftOriginal && provisionalPathwayId === namedPathwayFrame.id) {
      return saveShape();
    }
    if (!beginSaving("pathway-metadata")) return false;
    const before = pathwayDraftOriginal!;
    const result = await pathwayWorkflow.finalize({
      kind: "update",
      before,
      after: namedPathwayFrame,
      context: { nodes: currentNodes, existingPathways: currentPathways, campusBoundary },
      description: `Edit ${namedPathwayFrame.name}`,
    });
    if (!result.ok) {
      setError(result.message);
      endSaving();
      return false;
    }
    const persisted = result.pathway;
    overlay.putPathways([persisted]);
    setPathwayDraftOriginal({ ...persisted });
    setPathwayDraft({ ...persisted });
    setPathPoints([...persisted.pathPoints]);
    try {
      await refreshMapData();
      setPathDraftDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pathway was saved, but the map could not refresh. Retry the refresh before saving again.");
    } finally {
      endSaving();
    }
    return false;
  };

  const switchEndpoints = () => {
    if (!pathwayFrame) return;
    const reversedPoints = [...pathwayFrame.pathPoints].reverse();
    const currentDraft = pathwayDraft?.id === pathwayFrame.id ? pathwayDraft : pathwayFrame;
    setPathwayDraft({
      ...currentDraft,
      sourceNodeId: currentDraft.destinationNodeId,
      destinationNodeId: currentDraft.sourceNodeId,
      pathPoints: reversedPoints,
    });
    setPathwayDraftOriginal((current) => current?.id === pathwayFrame.id ? current : { ...pathwayFrame });
    if (editingPathId === pathwayFrame.id) setPathPoints(reversedPoints);
  };

  /** Discards a provisional pathway, or reverts staged edits to the saved pathway. */
  const cancelFrame = (): { discarded: true } | { discarded: false; pathwayId: string } => {
    if (!pathwayDraftOriginal) {
      if (provisionalPathwayId) overlay.dropPathway(provisionalPathwayId);
      setPathwayDraft(null);
      setPathwayDraftOriginal(null);
      setProvisionalPathwayId(null);
      setEditingPathId(null);
      setPathPoints([]);
      return { discarded: true };
    }
    setPathwayDraft({ ...pathwayDraftOriginal });
    setPathPoints([...pathwayDraftOriginal.pathPoints]);
    setPathDraftDirty(false);
    setSelectedPathPointIndex(null);
    setError("");
    return { discarded: false, pathwayId: pathwayDraftOriginal.id };
  };

  /** The pathway tool's draft, as persisted in the Working Session. */
  const draftSnapshot = useMemo<Omit<ActiveToolDraft, "id" | "isSuspended"> | null>(() => {
    return pathStartNodeId || pathDraftDirty ? ({
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
        provisionalPathwayId,
        provisionalPathway: provisionalPathwayId
          ? overlay.pathways.find((pathway) => pathway.id === provisionalPathwayId) ?? null
          : null,
      },
    }) : null;
  }, [
    activePathway?.destinationNodeId,
    activePathway?.sourceNodeId,
    editingPathId,
    overlay.pathways,
    pathDraftDirty,
    pathPoints,
    pathStartNodeId,
    provisionalPathwayId,
    selectedPathPointIndex,
  ]);

  /** Discards the pathway tool's draft geometry, and any provisional pathway record. */
  const clearToolDraft = () => {
    if (provisionalPathwayId) {
      overlay.dropPathway(provisionalPathwayId);
    }
    setPathPoints([]);
    setPathStartNodeId(null);
    setEditingPathId(null);
    setProvisionalPathwayId(null);
    setSelectedPathPointIndex(null);
    setPathDraftDirty(false);
  };

  /**
   * Starts the pathway tool; a legacy Open pathway is opened for reshaping
   * straight away. Returns the opened pathway, if any.
   */
  const activate = (): Pathway | null => {
    if (!editingPathId && (directoryPathways.length || overlay.pathways.length)) {
      const first = overlay.pathways[0] || directoryPathways[0];
      if (first?.status === "Open") {
        setEditingPathId(first.id);
        setPathwayDraft({ ...first });
        setPathwayDraftOriginal({ ...first });
        setPathPoints(first.pathPoints || []);
        return first;
      }
    }
    return null;
  };

  /** Restores a suspended or recovered pathway-tool draft. */
  const restoreDraft = (restoredPoints: MapPoint[], startNodeId: string | undefined, records: Record<string, unknown>) => {
    setPathPoints(restoredPoints);
    setPathStartNodeId(startNodeId ?? null);
    setEditingPathId(typeof records.editingPathId === "string" ? records.editingPathId : null);
    setSelectedPathPointIndex(typeof records.selectedPathPointIndex === "number" ? records.selectedPathPointIndex : null);
    const restoredProvisionalPathway = isPathwayDraft(records.provisionalPathway)
      ? { ...records.provisionalPathway, pathPoints: restoredPoints }
      : null;
    setProvisionalPathwayId(typeof records.provisionalPathwayId === "string" ? records.provisionalPathwayId : null);
    if (restoredProvisionalPathway) {
      overlay.putPathways([restoredProvisionalPathway]);
    }
    setPathDraftDirty(true);
  };

  return {
    currentPathways,
    pathwayCrossings,
    selectedPath,
    activePathway,
    pathwayFrame,
    namedPathwayFrame,
    pathwayFrameIssues,
    pathwayFrameDirty,
    editingPathId,
    setEditingPathId,
    pathwayDraft,
    setPathwayDraft,
    pathwayDraftOriginal,
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
    startNew,
    handleNodeClick,
    update,
    loadForSelection,
    insertPathPoint,
    saveShape,
    createJunctionAtCrossing,
    startConversion,
    updateConversionPathway,
    saveConversion,
    applyFrame,
    switchEndpoints,
    cancelFrame,
    draftSnapshot,
    clearToolDraft,
    activate,
    restoreDraft,
  };
}
