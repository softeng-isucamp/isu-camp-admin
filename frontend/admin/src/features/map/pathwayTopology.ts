import type { Pathway, RouteNode } from "../../types";

export interface GeographicCoordinate {
  latitude: number;
  longitude: number;
}

export interface PathwayCrossing {
  pathwayAId: string;
  pathwayBId: string;
  point: GeographicCoordinate;
}

function segmentMidpoint(
  start: GeographicCoordinate,
  end: GeographicCoordinate,
): GeographicCoordinate {
  return {
    latitude: (start.latitude + end.latitude) / 2,
    longitude: (start.longitude + end.longitude) / 2,
  };
}

export function pathwayConnectionError(
  sourceNodeId: string,
  destinationNodeId: string,
  pathways: Pathway[],
): string | null {
  if (sourceNodeId === destinationNodeId) {
    return "A Pathway must connect two distinct Route Nodes.";
  }
  const duplicate = pathways.some((pathway) => (
    (pathway.sourceNodeId === sourceNodeId && pathway.destinationNodeId === destinationNodeId)
      || (pathway.sourceNodeId === destinationNodeId && pathway.destinationNodeId === sourceNodeId)
  ));
  return duplicate ? "A direct Pathway already connects these Route Nodes." : null;
}

export function insertPathPointAtSegmentMidpoint(
  coordinates: GeographicCoordinate[],
  segmentIndex: number,
): GeographicCoordinate[] {
  const start = coordinates[segmentIndex];
  const end = coordinates[segmentIndex + 1];
  if (!start || !end) return coordinates;
  const midpoint = segmentMidpoint(start, end);
  return [...coordinates.slice(0, segmentIndex + 1), midpoint, ...coordinates.slice(segmentIndex + 1)];
}

export function segmentMidpoints(coordinates: GeographicCoordinate[]): GeographicCoordinate[] {
  return coordinates.slice(0, -1).map((start, index) =>
    segmentMidpoint(start, coordinates[index + 1]));
}

function pathwayCoordinates(pathway: Pathway, nodes: RouteNode[]): GeographicCoordinate[] | null {
  const source = nodes.find((node) => node.id === pathway.sourceNodeId);
  const destination = nodes.find((node) => node.id === pathway.destinationNodeId);
  return source && destination
    ? [
      { latitude: source.lat, longitude: source.lng },
      ...pathway.pathPoints.map(([latitude, longitude]) => ({ latitude, longitude })),
      { latitude: destination.lat, longitude: destination.lng },
    ]
    : null;
}

function interiorSegmentIntersection(
  a: GeographicCoordinate,
  b: GeographicCoordinate,
  c: GeographicCoordinate,
  d: GeographicCoordinate,
): GeographicCoordinate | null {
  const denominator = (a.latitude - b.latitude) * (c.longitude - d.longitude)
    - (a.longitude - b.longitude) * (c.latitude - d.latitude);
  if (Math.abs(denominator) < 1e-12) return null;
  const determinantAB = a.latitude * b.longitude - a.longitude * b.latitude;
  const determinantCD = c.latitude * d.longitude - c.longitude * d.latitude;
  const latitude = (determinantAB * (c.latitude - d.latitude)
    - (a.latitude - b.latitude) * determinantCD) / denominator;
  const longitude = (determinantAB * (c.longitude - d.longitude)
    - (a.longitude - b.longitude) * determinantCD) / denominator;
  const ratio = (point: number, start: number, end: number) => Math.abs(end - start) > 1e-12
    ? (point - start) / (end - start)
    : null;
  const pathwayARatio = ratio(latitude, a.latitude, b.latitude)
    ?? ratio(longitude, a.longitude, b.longitude);
  const pathwayBRatio = ratio(latitude, c.latitude, d.latitude)
    ?? ratio(longitude, c.longitude, d.longitude);
  const endpointTolerance = 1e-7;
  return pathwayARatio !== null && pathwayBRatio !== null
    && pathwayARatio >= -endpointTolerance && pathwayARatio <= 1 + endpointTolerance
    && pathwayBRatio >= -endpointTolerance && pathwayBRatio <= 1 + endpointTolerance
    ? {
      latitude: Object.is(latitude, -0) ? 0 : latitude,
      longitude: Object.is(longitude, -0) ? 0 : longitude,
    }
    : null;
}

export function findPathwayCrossings(pathways: Pathway[], nodes: RouteNode[]): PathwayCrossing[] {
  const crossings: PathwayCrossing[] = [];
  pathways.forEach((pathwayA, pathwayAIndex) => {
    const coordinatesA = pathwayCoordinates(pathwayA, nodes);
    if (!coordinatesA || pathwayA.status === "Closed") return;
    pathways.slice(pathwayAIndex + 1).forEach((pathwayB) => {
      const coordinatesB = pathwayCoordinates(pathwayB, nodes);
      if (!coordinatesB || pathwayB.status === "Closed") return;
      for (let aIndex = 0; aIndex < coordinatesA.length - 1; aIndex += 1) {
        for (let bIndex = 0; bIndex < coordinatesB.length - 1; bIndex += 1) {
          const point = interiorSegmentIntersection(
            coordinatesA[aIndex], coordinatesA[aIndex + 1],
            coordinatesB[bIndex], coordinatesB[bIndex + 1],
          );
          if (point) {
            const isRouteNodeEndpoint = (coordinates: GeographicCoordinate[]) =>
              [coordinates[0], coordinates[coordinates.length - 1]].some((endpoint) =>
                Math.abs(endpoint.latitude - point.latitude) < 1e-7
                && Math.abs(endpoint.longitude - point.longitude) < 1e-7,
              );
            if (isRouteNodeEndpoint(coordinatesA) || isRouteNodeEndpoint(coordinatesB)) continue;
            crossings.push({ pathwayAId: pathwayA.id, pathwayBId: pathwayB.id, point });
            return;
          }
        }
      }
    });
  });
  return crossings;
}

function splitPathPoints(
  pathway: Pathway,
  nodes: RouteNode[],
  point: GeographicCoordinate,
): { before: [number, number][]; after: [number, number][] } {
  const coordinates = pathwayCoordinates(pathway, nodes);
  if (!coordinates) return { before: [] as [number, number][], after: [] as [number, number][] };
  let closestSegmentIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const latitudeDelta = end.latitude - start.latitude;
    const longitudeDelta = end.longitude - start.longitude;
    const lengthSquared = latitudeDelta ** 2 + longitudeDelta ** 2;
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((point.latitude - start.latitude) * latitudeDelta
        + (point.longitude - start.longitude) * longitudeDelta) / lengthSquared,
    ));
    const projected: GeographicCoordinate = {
      latitude: start.latitude + projection * latitudeDelta,
      longitude: start.longitude + projection * longitudeDelta,
    };
    const distance = (projected.latitude - point.latitude) ** 2
      + (projected.longitude - point.longitude) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSegmentIndex = index;
    }
  }
  return {
    before: coordinates.slice(1, closestSegmentIndex + 1).map(({ latitude, longitude }) => [latitude, longitude] as [number, number]),
    after: coordinates.slice(closestSegmentIndex + 1, -1).map(({ latitude, longitude }) => [latitude, longitude] as [number, number]),
  };
}

export function createJunctionSplit(
  pathway: Pathway,
  nodes: RouteNode[],
  point: GeographicCoordinate,
  junctionId: string,
): { junction: RouteNode; pathways: [Pathway, Pathway] } {
  const junction: RouteNode = {
    id: junctionId,
    name: `Junction on ${pathway.name}`,
    nodeType: "Junction",
    lat: point.latitude,
    lng: point.longitude,
    status: "Active",
  };
  const split = splitPathPoints(pathway, nodes, point);
  return {
    junction,
    pathways: [
      { ...pathway, id: `${pathway.id}-a`, name: `${pathway.name} A`, destinationNodeId: junctionId, pathPoints: split.before },
      { ...pathway, id: `${pathway.id}-b`, name: `${pathway.name} B`, sourceNodeId: junctionId, pathPoints: split.after },
    ],
  };
}
