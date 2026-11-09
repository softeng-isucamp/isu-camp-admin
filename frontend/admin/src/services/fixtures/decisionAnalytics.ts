import type { AnalyticsPlaceRef, DashboardRange, DecisionAnalytics, DestinationType, Location, ReadinessGap } from "../../types";
import mapFixture from "../generated-map-fixture.json";
import { mulberry32 } from "./prng";

/**
 * Fixture for the Analytics page, built from the session's own Locations so every
 * quick link opens a record that exists. Photo, description, keywords and map pin
 * are read from the Locations; entrance links, rooms, searches, pathways and
 * travel modes are seeded, since the local adapter has no route graph or history.
 */
const SEARCH_SCALE: Record<DashboardRange, number> = { week: 1, month: 3.4, all: 9 };
// Matches the backend: only these (and legacy, unclassified Places) may hold indoor Locations.
const ROOM_HOLDERS = new Set(["College", "Campus Services", "Building", undefined]);
// Real fixture pathway IDs, so a closure bar opens a pathway the Map Editor can find.
const PATHWAY_IDS = mapFixture.walkingNetwork.pathways.map((pathway) => pathway.id);

const LABELS: Record<ReadinessGap, string> = {
  photo: "Photo",
  description: "Description",
  keywords: "Search keywords",
  pin: "Map pin",
  entrance: "Entrance linked",
  rooms: "Indoor rooms",
};

const ref = (place: Location): AnalyticsPlaceRef => ({ id: place.id, name: place.name });

export function generateDecisionAnalytics(range: DashboardRange, locations: Location[]): DecisionAnalytics {
  const rand = mulberry32(4207);
  const places = locations.filter((item) => item.type === "Place" && item.parentId === null && item.status === "Active");

  // Seeded per-place facts, fixed across ranges so only searches move with the range selector.
  const facts = places.map((place, index) => {
    const roll = rand();
    const holdsRooms = ROOM_HOLDERS.has(place.classification);
    return {
      place,
      entrance: index % 3 !== 1 && roll > 0.18,
      holdsRooms,
      rooms: holdsRooms && rand() > 0.72,
    };
  });

  const scale = SEARCH_SCALE[range];

  const gapsOf = (fact: (typeof facts)[number]): ReadinessGap[] => {
    const { place } = fact;
    const gaps: ReadinessGap[] = [];
    if (!(place.hasPhoto || place.photo)) gaps.push("photo");
    if (!place.function?.trim()) gaps.push("description");
    if (!place.keywords?.trim()) gaps.push("keywords");
    if (!(place.positioned || (place.lat != null && place.lng != null))) gaps.push("pin");
    if (!fact.entrance) gaps.push("entrance");
    if (fact.holdsRooms && !fact.rooms) gaps.push("rooms");
    return gaps;
  };

  const withGaps = facts.map((fact) => ({ fact, gaps: gapsOf(fact) }));
  const checks = (Object.keys(LABELS) as ReadinessGap[]).map((key) => {
    const applies = withGaps.filter(({ fact }) => key !== "rooms" || fact.holdsRooms);
    const missing = applies.filter(({ gaps }) => gaps.includes(key)).map(({ fact }) => ref(fact.place));
    return { key, label: LABELS[key], complete: applies.length - missing.length, total: applies.length, missing };
  });

  const routable = facts.filter((fact) => fact.entrance).map((fact) => fact.place);
  const pick = (start: number, count: number) => routable.slice(start, start + count).map(ref);
  const closures = [
    { pathway: "Junction → CCSICT walkway", cutOff: pick(0, 4), longerTrip: 6 },
    { pathway: "Infirmary entrance path", cutOff: pick(4, 2), longerTrip: 9 },
    { pathway: "Oval loop road", cutOff: [], longerTrip: 11 },
  ].map((row, index) => ({ id: PATHWAY_IDS[index % PATHWAY_IDS.length] ?? `pathway-${index}`, ...row }));

  const unreachable = (share: number, offset: number) => {
    const count = Math.round(routable.length * share);
    return Array.from({ length: count }, (_, i) => routable[(offset + i * 3) % routable.length]).filter(
      (place, i, all) => all.findIndex((other) => other.id === place.id) === i,
    ).map(ref);
  };
  const modes = [
    { mode: "Walking", unreachable: unreachable(0.05, 2) },
    { mode: "Bicycle", unreachable: unreachable(0.3, 1) },
    { mode: "Motorcycle", unreachable: unreachable(0.55, 0) },
    { mode: "Car", unreachable: unreachable(0.62, 5) },
  ].map((row) => ({ ...row, reachable: routable.length - row.unreachable.length }));

  const total = Math.round(59 * scale);
  const split = <K extends string>(keys: K[], shares: number[]) => {
    const values = shares.map((share) => Math.round(total * share));
    values[0] += total - values.reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Record<K, number>;
  };

  return {
    range,
    readiness: {
      total: places.length,
      fullyReady: withGaps.filter(({ gaps }) => gaps.length === 0).length,
      checks,
    },
    closures,
    reach: { origin: "Main Gate", total: routable.length, modes },
    searches: {
      total,
      byAccountType: split(["student", "teacher", "visitor"], [0.64, 0.22, 0.14]),
      byDestinationType: split<DestinationType>(["Building", "Room", "Office", "Laboratory", "Restroom"], [0.55, 0.18, 0.14, 0.09, 0.04]),
    },
  };
}
