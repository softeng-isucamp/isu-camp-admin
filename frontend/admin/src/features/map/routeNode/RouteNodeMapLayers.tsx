import { Marker, Tooltip } from "react-leaflet";
import type L from "leaflet";
import type { RouteNode } from "../../../types";
import { pointOnCampus, type MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import { createNodeIcon, createTempIcon } from "../mapIcons";
import type { PointSnapTarget } from "../pointInteractions";
import { PointMoveLayer } from "../PointMoveLayer";
import type { useRouteNodePointTool } from "./useRouteNodePointTool";

interface RouteNodeMarkersLayerProps {
  nodes: RouteNode[];
  mode: EditorMode;
  movingId: string | null;
  selectedNodeId: string | null;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onClickNode: (node: RouteNode) => void;
}

/** The committed Route Nodes; the node being moved is hidden while its move preview shows. */
export function RouteNodeMarkersLayer({
  nodes: filteredNodes,
  mode,
  movingId,
  selectedNodeId,
  campusBoundary,
  isOverviewZoom,
  onClickNode,
}: RouteNodeMarkersLayerProps) {
  return (
    <>
      {filteredNodes.map((node) => {
        if (mode === "move" && movingId === node.id) return null;
        const isSelected = selectedNodeId === node.id;
        if (isOverviewZoom && !isSelected) return null;
        return (
          <Marker
            key={node.id}
            position={[node.lat, node.lng]}
            icon={createNodeIcon(isSelected)}
            eventHandlers={{
              click: () => onClickNode(node),
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
    </>
  );
}

interface RouteNodeMoveLayerProps {
  pointTool: ReturnType<typeof useRouteNodePointTool>;
  mode: EditorMode;
  snapTargets: PointSnapTarget[];
  campusBoundary: MapPoint[];
  outsideBoundary: boolean;
  distanceMeters: number;
  isOverviewZoom: boolean;
}

/** The point tool's move preview: origin, draggable position, and snap targets. */
export function RouteNodeMoveLayer({
  pointTool,
  mode,
  snapTargets,
  campusBoundary,
  outsideBoundary,
  distanceMeters,
  isOverviewZoom,
}: RouteNodeMoveLayerProps) {
  return (
    <>
      {!isOverviewZoom && mode === "move" && pointTool.moveOrigin && pointTool.position && (
        <PointMoveLayer
          origin={pointTool.moveOrigin}
          position={pointTool.position}
          snapTargets={snapTargets}
          campusBoundary={campusBoundary}
          outsideBoundary={outsideBoundary}
          distanceMeters={distanceMeters}
          snapped={pointTool.snapped}
          onPositionChange={pointTool.updateMovePosition}
          onDropRejected={pointTool.rejectDrop}
          onDraggingChange={pointTool.setDragging}
        />
      )}
    </>
  );
}

interface RouteNodePlacementMarkerProps {
  pointTool: ReturnType<typeof useRouteNodePointTool>;
  mode: EditorMode;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onError: (message: string) => void;
}

/** The point tool's provisional marker while placing (draggable) or reviewing a position. */
export function RouteNodePlacementMarker({ pointTool, mode, campusBoundary, isOverviewZoom, onError: setError }: RouteNodePlacementMarkerProps) {
  return (
    <>
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
    </>
  );
}
