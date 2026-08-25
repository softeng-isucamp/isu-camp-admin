import fixture from "./generated-map-fixture.json";
import type { Building, Location, Pathway, RouteNode } from "../types";

type GeneratedFixture = typeof fixture;

const asBuilding = (value: GeneratedFixture["campus"]["buildings"][number]): Building => ({
  id: value.id,
  name: value.name ?? "Unnamed OSM building",
  code: value.ref ?? `OSM ${value.source.sourceType} ${value.source.sourceId}`,
  points: value.points.map(([lat, lng]) => [lat, lng]),
  source: value.source,
});

const asLocation = (value: GeneratedFixture["campus"]["locations"][number]): Location => ({
  id: value.id,
  name: value.name,
  code: value.code || `OSM ${value.source.sourceType} ${value.source.sourceId}`,
  type: value.type as Location["type"],
  parentId: value.parentId,
  status: value.status as Location["status"],
  lat: value.lat,
  lng: value.lng,
  positioned: value.positioned,
  source: value.source,
});

const asNode = (value: GeneratedFixture["walkingNetwork"]["routeNodes"][number]): RouteNode => ({
  id: value.id,
  name: value.name || `OSM node ${value.sourceOsmNodeId ?? value.id}`,
  nodeType: value.nodeType as RouteNode["nodeType"],
  lat: value.lat,
  lng: value.lng,
  sourceOsmNodeId: value.sourceOsmNodeId,
  sourceWayId: value.sourceWayId,
  sourceWayIds: value.sourceWayIds,
  source: value.source,
});

const asPathway = (value: GeneratedFixture["walkingNetwork"]["pathways"][number]): Pathway => ({
  id: value.id,
  name: value.name,
  sourceNodeId: value.sourceNodeId,
  destinationNodeId: value.destinationNodeId,
  pathPoints: value.pathPoints.map(([lat, lng]) => [lat, lng]),
  sourceOsmNodeIds: value.sourceOsmNodeIds,
  sourceWayId: value.sourceWayId,
  source: value.source,
  distance: value.distance,
  time: value.time,
  shade: value.shade as Pathway["shade"],
  type: value.type,
  direction: value.direction as Pathway["direction"],
  status: value.status as Pathway["status"],
});

export const generatedMapFixture = {
  attribution: fixture.attribution,
  buildings: fixture.campus.buildings.map(asBuilding),
  locations: fixture.campus.locations.map(asLocation),
  nodes: fixture.walkingNetwork.routeNodes.map(asNode),
  pathways: fixture.walkingNetwork.pathways.map(asPathway),
};
