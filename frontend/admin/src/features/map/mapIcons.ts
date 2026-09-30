import L from "leaflet";
import type { Location } from "../../types";
import { locationTypeIconContents } from "../locations/LocationTypeIcon";

export const createLocationPinIcon = (selected = false) =>
  L.divIcon({
    className: `location-marker-icon ${selected ? "selected" : ""}`,
    html: `<div class="location-icon ${selected ? "selected" : ""}"><span class="location-pin"></span></div>`,
    iconSize: [26, 32],
    iconAnchor: [13, 30],
  });

export const createIndoorLocationIcon = (type: Location["type"], selected = false) =>
  L.divIcon({
    className: `indoor-location-marker-icon type-${type.toLowerCase()}${selected ? " selected" : ""}`,
    html: `<span class="indoor-location-pin"><span class="indoor-location-type-symbol"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${locationTypeIconContents(type)}</svg></span></span>`,
    iconSize: [36, 44],
    iconAnchor: [18, 40],
  });

export const createNodeIcon = (selected = false) =>
  L.divIcon({
    className: `route-node-icon ${selected ? "selected" : ""}`,
    html: `<div class="route-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const pointIcons = new Map<boolean, L.DivIcon>();
export const createPointIcon = (selected = false) => {
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

export const createTempIcon = () =>
  L.divIcon({
    className: "temp-marker-icon",
    html: `<div class="temp-icon"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

export const createGhostPointIcon = () =>
  L.divIcon({
    className: "point-move-ghost-icon",
    html: `<div class="point-move-ghost"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

export const createMovingPointIcon = (outsideBoundary: boolean, elevated: boolean) =>
  L.divIcon({
    className: `point-moving-icon${outsideBoundary ? " outside-boundary" : ""}${elevated ? " elevated" : ""}`,
    html: `<div class="point-moving-marker${outsideBoundary ? " outside-boundary" : ""}${elevated ? " elevated" : ""}"><span></span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 36],
  });

const splitIcon = L.divIcon({ className: "polygon-split-handle", html: "<span>+</span>", iconSize: [24, 24], iconAnchor: [12, 12] });
export const createSplitIcon = () => splitIcon;

const vertexIcons = new Map<number, L.DivIcon>();
export const createVertexIcon = (index: number) => {
  const existing = vertexIcons.get(index);
  if (existing) return existing;
  const icon = L.divIcon({ className: "polygon-vertex-handle", html: `<span>V${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  vertexIcons.set(index, icon);
  return icon;
};
