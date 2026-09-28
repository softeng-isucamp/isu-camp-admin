import { useState } from "react";
import type { RouteNode } from "../../../types";
import { pointOnCampus, type MapPoint } from "../campusBoundary";
import type { MapOverlay } from "../session/useMapOverlay";
import type { SavingAction } from "../session/useSavingAction";
import type { RouteNodeValidationContext, RouteNodeWorkflow } from "./RouteNodeWorkflow";

export type PlacingNodeType = "Entrance" | "Junction" | "Access Point";

export interface PointToolContext extends RouteNodeValidationContext {
  nodes: readonly RouteNode[];
  campusBoundary: MapPoint[];
}

interface UseRouteNodePointToolOptions {
  workflow: RouteNodeWorkflow;
  overlay: MapOverlay;
  saving: SavingAction;
  context: PointToolContext;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
}

const REFRESH_FAILED = "Route Node was saved, but the map could not refresh. Retry the refresh before saving again.";
const isPlacingNodeType = (value: unknown): value is PlacingNodeType =>
  value === "Entrance" || value === "Junction" || value === "Access Point";

/**
 * The point tool: placing a new Route Node and moving an existing one.
 * Owns the provisional position and the placement/move draft state; the caller
 * owns editor mode and selection, and reacts to the saves' results.
 */
export function useRouteNodePointTool({ workflow, overlay, saving, context, refreshMapData, onError }: UseRouteNodePointToolOptions) {
  const [position, setPosition] = useState<MapPoint | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [snapped, setSnapped] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<MapPoint | null>(null);
  const [lastValidMovePosition, setLastValidMovePosition] = useState<MapPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropRejected, setDropRejected] = useState(false);
  const [placingNodeType, setPlacingNodeType] = useState<PlacingNodeType>("Entrance");
  const [placingNodeName, setPlacingNodeName] = useState("");
  const [placingAssociatedBuildingId, setPlacingAssociatedBuildingId] = useState<string | null>(null);

  const validation: RouteNodeValidationContext = {
    buildings: context.buildings,
    locations: context.locations,
    campusBoundary: context.campusBoundary,
  };

  /** Clears the provisional position and its draft. */
  const reset = () => {
    setPosition(null);
    setDraftDirty(false);
  };

  /** Positions the provisional point from a map click. */
  const placeAt = (point: MapPoint) => {
    setPosition(point);
    setSnapped(false);
    setDraftDirty(true);
  };

  /** Positions the provisional point from a drag or a typed coordinate. */
  const editPosition = (point: MapPoint) => {
    setPosition(point);
    setDraftDirty(true);
  };

  /** Starts a fresh placement draft for the point tool. */
  const activatePlacement = () => {
    setPlacingNodeType("Entrance");
    setPlacingNodeName("");
    setPlacingAssociatedBuildingId(null);
    setDraftDirty(false);
  };

  /** Starts placing a named Entrance for a Building. */
  const beginEntrancePlacement = (name: string, buildingId: string) => {
    setPlacingNodeType("Entrance");
    setPlacingNodeName(name);
    setPlacingAssociatedBuildingId(buildingId);
    reset();
  };

  const startMove = (node: RouteNode) => {
    setMovingId(node.id);
    const origin: MapPoint = [node.lat, node.lng];
    setMoveOrigin(origin);
    setLastValidMovePosition(origin);
    setPosition(origin);
    setSnapped(false);
    setDropRejected(false);
    setDraftDirty(false);
  };

  const updateMovePosition = (point: MapPoint, pointSnapped = false) => {
    setPosition(point);
    if (pointOnCampus(point, context.campusBoundary)) setLastValidMovePosition(point);
    setSnapped(pointSnapped);
    setDropRejected(false);
    setDraftDirty(true);
    onError("");
  };

  const rejectDrop = () => {
    setPosition(lastValidMovePosition ?? moveOrigin);
    setSnapped(false);
    setDropRejected(true);
    onError("");
  };

  const cancelMove = () => {
    setPosition(null);
    setMoveOrigin(null);
    setLastValidMovePosition(null);
    setSnapped(false);
    setDropRejected(false);
    setDragging(false);
    setDraftDirty(false);
    onError("");
  };

  /**
   * Persists the moved position. Resolves to the moved node's id when the move
   * completed (the caller then returns to selection), or null otherwise.
   */
  const savePosition = async (): Promise<string | null> => {
    if (!position) return null;
    if (!saving.beginSaving("position")) return null;
    let completedId: string | null = null;
    if (movingId) {
      const existing = context.nodes.find((node) => node.id === movingId);
      if (existing) {
        const updated = { ...existing, lat: position[0], lng: position[1] };
        const result = await workflow.finalize({
          kind: "update",
          before: existing,
          after: updated,
          context: validation,
          description: `Move ${updated.name}`,
        });
        if (!result.ok) {
          onError(result.message);
          saving.endSaving();
          return null;
        }
        overlay.putNode(result.node);
        try {
          await refreshMapData();
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : REFRESH_FAILED);
          saving.endSaving();
          return null;
        }
      }
      completedId = movingId;
    }
    setPosition(null);
    setMoveOrigin(null);
    setSnapped(false);
    setDragging(false);
    saving.endSaving();
    return completedId;
  };

  /**
   * Persists the placed Route Node. Resolves to the confirmed node and the draft
   * it was placed from, or null when nothing was placed.
   */
  const savePlacedNode = async (): Promise<{ node: RouteNode; draft: Omit<RouteNode, "id"> } | null> => {
    if (!position || !placingNodeName.trim()) return null;
    if (!saving.beginSaving("route-node")) return null;
    const draft: Omit<RouteNode, "id"> = {
      name: placingNodeName.trim(),
      nodeType: placingNodeType,
      associatedPlaceId: placingNodeType === "Entrance" ? placingAssociatedBuildingId || null : null,
      lat: position[0],
      lng: position[1],
    };
    const result = await workflow.finalize({ kind: "create", draft, context: validation, description: `Place ${draft.name}` });
    if (!result.ok) {
      onError(result.message);
      saving.endSaving();
      return null;
    }
    const confirmedNode = result.node;
    try {
      overlay.putNode(confirmedNode);
      await refreshMapData();
      setPlacingNodeName("");
      return { node: confirmedNode, draft };
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : REFRESH_FAILED);
      return null;
    } finally {
      saving.endSaving();
    }
  };

  /** The nested records persisted with a point-tool draft. */
  const draftRecords = { placingNodeType, placingNodeName, placingAssociatedBuildingId, movingId };

  /** Restores a suspended or recovered point-tool draft. */
  const restoreDraft = (point: MapPoint | null, records: Record<string, unknown>) => {
    setPosition(point);
    setDraftDirty(true);
    if (isPlacingNodeType(records.placingNodeType)) setPlacingNodeType(records.placingNodeType);
    if (typeof records.placingNodeName === "string") setPlacingNodeName(records.placingNodeName);
    if (typeof records.placingAssociatedBuildingId === "string" || records.placingAssociatedBuildingId === null) {
      setPlacingAssociatedBuildingId(records.placingAssociatedBuildingId);
    } else if (typeof records.placingAssociatedPlaceId === "string" || records.placingAssociatedPlaceId === null) {
      setPlacingAssociatedBuildingId(records.placingAssociatedPlaceId);
    }
    setMovingId(typeof records.movingId === "string" ? records.movingId : null);
  };

  return {
    position,
    draftDirty,
    snapped,
    movingId,
    moveOrigin,
    dragging,
    dropRejected,
    placingNodeType,
    placingNodeName,
    placingAssociatedBuildingId,
    draftRecords,
    setPosition,
    setDraftDirty,
    setDragging,
    setPlacingNodeType,
    setPlacingNodeName,
    setPlacingAssociatedBuildingId,
    reset,
    placeAt,
    editPosition,
    activatePlacement,
    beginEntrancePlacement,
    startMove,
    updateMovePosition,
    rejectDrop,
    cancelMove,
    savePosition,
    savePlacedNode,
    restoreDraft,
  };
}
