import { useCallback, useState } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";

type Identified = { id: string };
export type OverlayCollection = "locations" | "nodes" | "pathways" | "buildings";

const withPut = <T extends Identified>(items: T[], puts: T[], replacing: readonly string[] = []) => [
  ...items.filter((item) => !replacing.includes(item.id) && !puts.some((put) => put.id === item.id)),
  ...puts,
];
const without = <T extends Identified>(items: T[], id: string) => items.filter((item) => item.id !== id);

/**
 * Working-session overlay for Locations, Route Nodes, Pathways, and Buildings:
 * records changed in this session that shadow the directory data until refresh.
 */
export function useMapOverlay(directoryBuildings: readonly Building[] | undefined) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [deletedPathwayIds, setDeletedPathwayIds] = useState<string[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  const putLocation = useCallback((location: Location) => setLocations((items) => withPut(items, [location])), []);
  const putNode = useCallback((node: RouteNode) => setNodes((items) => withPut(items, [node])), []);
  const putBuilding = useCallback((building: Building) => setBuildings((items) => withPut(items, [building])), []);
  /** Puts each pathway by id; `replacing` also drops overlay entries under other ids (e.g. a provisional id). */
  const putPathways = useCallback((puts: Pathway[], replacing: readonly string[] = []) => {
    setPathways((items) => withPut(items, puts, replacing));
  }, []);

  /** Adds directory nodes to the overlay unless it already holds a copy. */
  const ensureNodes = useCallback((ensure: RouteNode[]) => {
    setNodes((items) => [...items, ...ensure.filter((node) => !items.some((item) => item.id === node.id))]);
  }, []);

  /** Replaces the overlay copy of a building, if the overlay holds one. */
  const refreshBuilding = useCallback((building: Building) => {
    setBuildings((items) => items.map((item) => item.id === building.id ? building : item));
  }, []);

  const removeLocation = useCallback((id: string) => setLocations((items) => without(items, id)), []);
  const removeNode = useCallback((id: string) => setNodes((items) => without(items, id)), []);
  const removeBuilding = useCallback((id: string) => setBuildings((items) => without(items, id)), []);
  /** Discards an unsaved (provisional) pathway. */
  const dropPathway = useCallback((id: string) => setPathways((items) => without(items, id)), []);
  /** Removes a pathway and hides its directory copy. */
  const deletePathway = useCallback((id: string) => {
    setPathways((items) => without(items, id));
    setDeletedPathwayIds((ids) => [...new Set([...ids, id])]);
  }, []);

  const reset = useCallback(() => {
    setLocations([]);
    setNodes([]);
    setPathways([]);
    setDeletedPathwayIds([]);
    setBuildings([]);
  }, []);

  return {
    locations,
    nodes,
    pathways,
    deletedPathwayIds,
    buildings,
    putLocation,
    putNode,
    putBuilding,
    putPathways,
    ensureNodes,
    refreshBuilding,
    removeLocation,
    removeNode,
    removeBuilding,
    dropPathway,
    deletePathway,
    reset,
  };
}

export type MapOverlay = ReturnType<typeof useMapOverlay>;
