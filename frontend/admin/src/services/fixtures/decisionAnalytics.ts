import type { AnalyticsPlaceRef, DashboardRange, DecisionAnalytics, DestinationType, Location, ReadinessGap } from "../../types";
import mapFixture from "../generated-map-fixture.json";
import { indoorLocationTypes, isLocationContainer } from "../../lib/locationPolicy";
import { mulberry32 } from "./prng";

/**
 * Fixture for the Analytics page, built from the session's own Locations so every
 * quick link opens a record that exists. Photo, description, keywords, map pin and
 * indoor rooms are read from the Locations; entrance links, searches, pathways and
 * travel modes are seeded, since the local adapter has no route graph or history.
 */
/** Searches relative to a week: a past year is a full school year, this year is part of one. */
const searchScale = (range: DashboardRange) => {
  if (range === "week") return 1;
  if (range === "month") return 3.4;
  if (range === "all") return 9;
  return Number(range.slice(5)) === new Date().getFullYear() ? 6 : 4.5;
};
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

  // Rooms follow the shared policy (only Places that may hold indoor Locations are asked) and the real children.
  const withRooms = new Set(
    locations
      .filter((item) => item.status === "Active" && item.parentId && indoorLocationTypes.includes(item.type as (typeof indoorLocationTypes)[number]))
      .map((item) => item.parentId),
  );
  // Entrance links are seeded, fixed across ranges so only searches move with the range selector.
  const facts = places.map((place, index) => {
    const holdsRooms = isLocationContainer(place);
    return {
      place,
      entrance: index % 3 !== 1 && rand() > 0.18,
      holdsRooms,
      rooms: holdsRooms && withRooms.has(place.id),
    };
  });

  const scale = searchScale(range);

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
    const have = applies.filter(({ gaps }) => !gaps.includes(key)).map(({ fact }) => ref(fact.place));
    return { key, label: LABELS[key], complete: have.length, total: applies.length, missing, have };
  });

  const routable = facts.filter((fact) => fact.entrance).map((fact) => fact.place);
  const pick = (start: number, count: number) => routable.slice(start, start + count).map(ref);
  // Places that only get a longer walk come from the routable places a closure does not cut off.
  const detour = (cutOff: AnalyticsPlaceRef[], start: number, count: number) => {
    const cut = new Set(cutOff.map((place) => place.id));
    return routable.filter((place) => !cut.has(place.id)).slice(start, start + count).map(ref);
  };
  const closures = [
    { pathway: "Junction → CCSICT walkway", cutOff: pick(0, 4), longer: 6, start: 0 },
    { pathway: "Infirmary entrance path", cutOff: pick(4, 2), longer: 9, start: 3 },
    { pathway: "Oval loop road", cutOff: [] as AnalyticsPlaceRef[], longer: 11, start: 1 },
  ].map(({ pathway, cutOff, longer, start }, index) => {
    const longerPlaces = detour(cutOff, start, longer);
    return { id: PATHWAY_IDS[index % PATHWAY_IDS.length] ?? `pathway-${index}`, pathway, cutOff, longerTrip: longerPlaces.length, longerPlaces };
  });

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
  ].map((row) => {
    const missed = new Set(row.unreachable.map((place) => place.id));
    const reachablePlaces = routable.filter((place) => !missed.has(place.id)).map(ref);
    return { ...row, reachable: reachablePlaces.length, reachablePlaces };
  });

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
