import { Marker, Polyline, Tooltip } from "react-leaflet";
import type L from "leaflet";
import { normalizePathwayWayType, type Pathway, type RouteNode } from "../../../types";
import { geometryOnCampus, pointOnCampus, type MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import { createPointIcon, splitIcon } from "../mapIcons";
import type { usePathwayEditing } from "./usePathwayEditing";
import { segmentMidpoints } from "./pathwayTopology";
import { pathwayStroke } from "./pathwayStyle";

interface PathwaysLayerProps {
  pathway: ReturnType<typeof usePathwayEditing>;
  pathways: Pathway[];
  nodes: RouteNode[];
  mode: EditorMode;
  selectedPathId: string | null;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onSelectPathway: (pathwayId: string, anchor: MapPoint) => void;
}

/** The committed Pathways; the one being reshaped follows its draft points and drag preview. */
export function PathwaysLayer({
  pathway,
  pathways: filteredPathways,
  nodes: currentNodes,
  mode,
  selectedPathId,
  campusBoundary,
  isOverviewZoom,
  onSelectPathway,
}: PathwaysLayerProps) {
  const { editingPathId, pathPoints, pathPointDragPreview, pathwayDraft } = pathway;
  return (
    <>
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
        const isSelected = selectedPathId === path.id || isEditingThisPath;
        // An unsaved Way type shows at once, whether it was changed in the pathway tool or the inspector.
        const draftType = pathwayDraft?.id === path.id ? pathwayDraft.type : path.type;
        const wayType = normalizePathwayWayType(draftType) === "Road" ? "Road" : "Walkway";
        const outsideBoundary = !source || !destination || !geometryOnCampus(
          [[source.lat, source.lng], ...currentPoints, [destination.lat, destination.lng]],
          campusBoundary,
        );

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
              ...pathwayStroke({ type: wayType, selected: isSelected, outsideBoundary, isOverviewZoom, pathTool: mode === "path" }),
              opacity: pathOpacity,
            }}
            eventHandlers={{
              click: (event) => {
                onSelectPathway(path.id, event.latlng
                  ? [event.latlng.lat, event.latlng.lng]
                  : [source.lat, source.lng]);
              },
            }}
          >
            {!isOverviewZoom && <Tooltip sticky direction="top" className="map-label">
              <div className="font-bold text-xs">{path.name || "Campus Pathway"}</div>
              <div className="text-[10px] text-gray-500 font-normal">{wayType} · Shade: {path.shade} · {path.direction}</div>
              {outsideBoundary && (
                <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
              )}
            </Tooltip>}
          </Polyline>
        ) : null;
      })}
    </>
  );
}

interface PathwayDraftLayerProps {
  pathway: ReturnType<typeof usePathwayEditing>;
  nodes: RouteNode[];
  mode: EditorMode;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onSelect: (selection: { type: "path_point"; id: string }) => void;
  onError: (message: string) => void;
}

/** The pathway tool's Path Point markers and, for the active Pathway, its midpoint split handles. */
export function PathwayDraftLayer({
  pathway,
  nodes: currentNodes,
  mode,
  campusBoundary,
  isOverviewZoom,
  onSelect: setSelected,
  onError: setError,
}: PathwayDraftLayerProps) {
  const {
    activePathway,
    editingPathId,
    pathPoints,
    setPathPoints,
    selectedPathPointIndex,
    setSelectedPathPointIndex,
    setPathDraftDirty,
    setPathPointDragPreview,
    insertPathPoint,
  } = pathway;
  return (
    <>
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
              icon={splitIcon}
              eventHandlers={{ click: () => insertPathPoint(segmentIndex) }}
            />
          );
        });
      })()}
    </>
  );
}
