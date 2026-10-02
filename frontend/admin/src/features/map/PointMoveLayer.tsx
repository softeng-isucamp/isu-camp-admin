import { useEffect, useRef, useState } from "react";
import { Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { pointOnCampus, type MapPoint } from "./campusBoundary";
import { ghostPointIcon, movingPointIcon } from "./mapIcons";
import { findPointSnap, type PointSnapTarget } from "./pointInteractions";

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

export function PointMoveLayer({
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
  const movingMarkerRef = useRef<L.Marker>(null);
  useEffect(() => {
    const marker = movingMarkerRef.current;
    const applyOutsideBoundary = () => {
      const element = marker?.getElement();
      element?.classList.toggle("outside-boundary", outsideBoundary);
      element?.querySelector(".point-moving-marker")?.classList.toggle("outside-boundary", outsideBoundary);
    };
    applyOutsideBoundary();
    marker?.on("add", applyOutsideBoundary);
    return () => {
      marker?.off("add", applyOutsideBoundary);
    };
  }, [outsideBoundary]);
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
      <Marker position={origin} icon={ghostPointIcon} />
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
        ref={movingMarkerRef}
        position={position}
        icon={movingPointIcon}
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

export function PointCoordinateInputs({ position, onChange }: PointCoordinateInputsProps) {
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
