import type { AnalyticsPlaceRef, DashboardRange, DecisionAnalytics, DestinationType, Location, IndoorMarkerRow, ReadinessGap, SearchActivityPoint, UserAccountType } from "../../types";
import mapFixture from "../generated-map-fixture.json";
import { indoorLocationTypes, isLocationContainer } from "../../lib/locationPolicy";
import { mulberry32 } from "./prng";

/**
 * Fixture for the Analytics page, built from the session's own Locations so every
 * quick link opens a record that exists. Photo, keywords and
 * indoor locations are read from the Locations; entrance links, searches, pathways and
 * Walking and Vehicle reach are seeded, since the local adapter has no route graph or history.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Splits `total` across `weights` in whole numbers that add up to it exactly (largest remainder). */
const apportion = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const counts = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  const remainder = total - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i += 1) counts[order[i].index] += 1;
  return counts;
};

/** The bucket start days a range plots: days for a week or month, weeks (named by their first day) for all time and a year. */
const bucketStarts = (range: DashboardRange): { bucket: "day" | "week"; dates: string[] } => {
  const today = manilaToday();
  if (range === "week" || range === "month") {
    const length = range === "week" ? 7 : 30;
    return { bucket: "day", dates: Array.from({ length }, (_, i) => shiftDay(today, i - (length - 1))) };
  }
  const first = range === "all" ? shiftDay(today, -7 * 25) : `${range.slice(5)}-01-01`;
  const last = range === "all" ? today : `${range.slice(5)}-12-31` < today ? `${range.slice(5)}-12-31` : today;
  const dates: string[] = [];
  for (let day = first; day <= last; day = shiftDay(day, 7)) dates.push(day);
  return { bucket: "week", dates };
};

/** An indoor Location has a marker only with its own coordinates (or a position the fixture already resolved). */
const hasMarker = (place: Location) => place.positioned || (place.lat != null && place.lng != null);

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
  keywords: "Search keywords",
  entrance: "Entrance linked",
  rooms: "Indoor locations",
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
    if (!place.keywords?.trim()) gaps.push("keywords");
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
    // One Vehicle bar: the admin stores a single Vehicle permission for bicycles, motorcycles and cars.
    { mode: "Vehicle", unreachable: unreachable(0.45, 0) },
  ].map((row) => {
    const missed = new Set(row.unreachable.map((place) => place.id));
    const reachablePlaces = routable.filter((place) => !missed.has(place.id)).map(ref);
    return { ...row, reachable: reachablePlaces.length, reachablePlaces };
  });

  const total = Math.round(59 * scale);
  const accountShares = [0.64, 0.22, 0.14];
  const accountKeys: UserAccountType[] = ["student", "teacher", "visitor"];

  // Searches over time: busier on weekdays, split by account type per bucket.
  const { bucket, dates } = bucketStarts(range);
  const perBucket = apportion(total, dates.map((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return bucket === "day" ? (weekday === 0 || weekday === 6 ? 0.25 : 1) * (0.6 + rand()) : 0.6 + rand();
  }));
  const points: SearchActivityPoint[] = dates.map((date, index) => {
    const [student, teacher, visitor] = apportion(perBucket[index], accountShares.map((share) => share * (0.7 + rand() * 0.6)));
    return { date, total: perBucket[index], student, teacher, visitor };
  });
  const byAccountType = Object.fromEntries(accountKeys.map((key) => [key, points.reduce((sum, point) => sum + point[key], 0)])) as Record<UserAccountType, number>;

  // Every active indoor Location under an active Place, searched or not. A marker is the Location's own coordinates.
  const placeIds = new Set(places.map((place) => place.id));
  const indoorMarkers: IndoorMarkerRow[] = (["Room", "Laboratory", "Office", "Restroom"] as const).map((type) => {
    const records = locations
      .filter((item) => item.status === "Active" && item.type === type && item.parentId && placeIds.has(item.parentId))
      .sort((a, b) => a.name.localeCompare(b.name));
    const have = records.filter(hasMarker).map(ref);
    return { type, total: records.length, marked: have.length, missing: records.filter((record) => !hasMarker(record)).map(ref), have };
  });

  return {
    range,
    readiness: {
      total: places.length,
      checks,
      indoorMarkers,
    },
    closures,
    reach: { origin: "Main Gate", total: routable.length, modes },
    searches: { total, byAccountType, activity: { bucket, points } },
  };
}
