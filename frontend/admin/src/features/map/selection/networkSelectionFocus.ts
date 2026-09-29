import type { Pathway, RouteNode } from "../../../types";
import type { NetworkBrowserSelection } from "../NetworkBrowser";

export type NetworkSelectionFocus =
  | { kind: "fly"; point: [number, number] }
  | { kind: "frame"; bounds: [[number, number], [number, number]] };

/** Where the map should look after an object is picked in the Network Browser. */
export function networkSelectionFocus(
  selection: NonNullable<NetworkBrowserSelection>,
  nodes: RouteNode[],
  pathways: Pathway[],
): NetworkSelectionFocus | null {
  if (selection.type === "node") {
    const node = nodes.find((item) => item.id === selection.id);
    return node ? { kind: "fly", point: [node.lat, node.lng] } : null;
  }
  const pathway = pathways.find((item) => item.id === selection.id);
  const source = pathway && nodes.find((node) => node.id === pathway.sourceNodeId);
  const destination = pathway && nodes.find((node) => node.id === pathway.destinationNodeId);
  if (!pathway || !source || !destination) return null;
  const points = [[source.lat, source.lng], ...pathway.pathPoints, [destination.lat, destination.lng]] as [number, number][];
  return {
    kind: "frame",
    bounds: [
      [Math.min(...points.map(([lat]) => lat)), Math.min(...points.map(([, lng]) => lng))],
      [Math.max(...points.map(([lat]) => lat)), Math.max(...points.map(([, lng]) => lng))],
    ],
  };
}
