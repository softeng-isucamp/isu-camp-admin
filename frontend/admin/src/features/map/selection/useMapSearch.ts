import { useMemo, useState } from "react";
import type { Location, Pathway, RouteNode } from "../../../types";
import { isPositionedLocation } from "../indoorLocation/indoorLocations";

export interface MapSearchResult {
  id: string;
  kind: "Location" | "Route Node" | "Pathway";
  name: string;
  lat?: number | null;
  lng?: number | null;
}

export interface SearchableMapData {
  directoryLocations: Location[];
  directoryNodes: RouteNode[];
  overlayLocations: Location[];
  overlayNodes: RouteNode[];
  pathways: Pathway[];
}

/** Campus place search: query state, matching results, and picking a result. */
export function useMapSearch(
  data: SearchableMapData,
  selectObject: (type: "location" | "node" | "pathway", id: string) => void,
  flyTo: (point: [number, number]) => void,
) {
  const { directoryLocations, directoryNodes, overlayLocations, overlayNodes, pathways } = data;
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const allLocs = directoryLocations.length ? directoryLocations : overlayLocations;
    const allNodes = directoryNodes.length ? directoryNodes : overlayNodes;
    const allPaths = pathways;

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
  }, [pathways, directoryLocations, directoryNodes, overlayLocations, overlayNodes, search]);

  const selectResult = (item: MapSearchResult) => {
    if (item.kind === "Location") {
      selectObject("location", item.id);
      const loc = directoryLocations.find((l) => l.id === item.id) || overlayLocations.find((l) => l.id === item.id);
      if (loc && isPositionedLocation(loc)) flyTo([loc.lat, loc.lng]);
    } else if (item.kind === "Route Node") {
      selectObject("node", item.id);
      const n = directoryNodes.find((node) => node.id === item.id) || overlayNodes.find((node) => node.id === item.id);
      if (n) flyTo([n.lat, n.lng]);
    } else if (item.kind === "Pathway") {
      selectObject("pathway", item.id);
      const p = pathways.find((path) => path.id === item.id);
      if (p) {
        const src = directoryNodes.find((n) => n.id === p.sourceNodeId) || overlayNodes.find((n) => n.id === p.sourceNodeId);
        if (src) flyTo([src.lat, src.lng]);
      }
    }
    setSearch("");
  };

  return { search, setSearch, results, selectResult };
}
