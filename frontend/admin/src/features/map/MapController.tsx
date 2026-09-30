import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";

interface MapControllerProps {
  onMapClick: (latlng: [number, number]) => void;
  flyTarget: [number, number] | null;
  frameBounds: [[number, number], [number, number]] | null;
  navigationBounds: [[number, number], [number, number]];
  onViewportChange?: (bounds: L.LatLngBounds | null, zoom: number) => void;
  flyTargetZoom?: number;
}

export function MapController({
  onMapClick,
  flyTarget,
  frameBounds,
  navigationBounds,
  onViewportChange,
  flyTargetZoom = 19,
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
      map.flyTo(flyTarget, flyTargetZoom, { duration: 0.8 });
    }
  }, [flyTarget, flyTargetZoom, map]);

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
