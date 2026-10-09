import { locationIdentityKey } from "../../lib/locationPolicy";
import type {
  AnalyticsDestination,
  AnalyticsTotals,
  Building,
  CompletenessCheck,
  DashboardAnalytics,
  DashboardRange,
  DestinationType,
  Location,
  UserAccountType,
} from "../../types";
import { mulberry32 } from "./prng";

/**
 * Deterministic fixture for `GET /api/dashboard/analytics`.
 *
 * Every number derives from a seeded PRNG keyed by the absolute Manila calendar day, so
 * every teammate sees identical values on a given day. Real destination names come from
 * the fixture locations. All bucketing uses Asia/Manila (UTC+8, no DST).
 */

const SEED = 20260918;
const HISTORY_DAYS = 84; // 12 weeks, ending today
const TARGET_USERS = 600;
const FIRST_HOUR = 6;
const LAST_HOUR = 21;
const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000;

const WEEKDAY_FACTOR = [1.0, 1.05, 1.0, 0.95, 0.85, 0.18, 0.08]; // Mon..Sun
const HOUR_PEAKS: Array<[center: number, weight: number]> = [[7.5, 0.2], [10.5, 0.28], [13, 0.27], [16, 0.25]];
const ACCOUNT_SHARE = { teacher: 0.08, visitor: 0.12 }; // students take the remainder
const SIGNED_IN_SHARE = 0.78;
const INDOOR_TYPES: DestinationType[] = ["Room", "Laboratory", "Office", "Restroom"];
const INDOOR_TYPE_SHARE: Record<string, number> = { Room: 0.4, Laboratory: 0.25, Office: 0.2, Restroom: 0.15 };
const INDOOR_TRAFFIC_SHARE = 0.35;

const seededRandom = (dayNumber: number, salt = 0) => mulberry32((SEED ^ Math.imul(dayNumber, 2654435761) ^ salt) | 0);

const manilaDayNumber = (now: number) => Math.floor((now + MANILA_OFFSET_MS) / DAY_MS);
const dayToDate = (dayNumber: number) => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
/** 0 = Monday .. 6 = Sunday. Epoch day 0 was a Thursday. */
const weekdayOf = (dayNumber: number) => (((dayNumber + 3) % 7) + 7) % 7;

type Destination = {
  id: string;
  name: string;
  context: string;
  type: DestinationType;
  weight: number;
  arrival: number;
};

type Day = {
  date: string;
  weekday: number;
  activeUsers: number[];
  hourly: number[]; // searches by hour 0..23
  searches: number;
  visits: number;
  visitsByAccount: Record<UserAccountType, number>;
  destSearches: number[];
  destVisits: number[];
  registrations: Record<UserAccountType, number>;
};

type Model = { days: Day[]; destinations: Destination[] };

const buildDestinations = (locations: Location[]): Destination[] => {
  const rand = mulberry32(SEED);
  const active = locations.filter((location) => location.status === "Active");
  const seenNames = new Set<string>();
  const buildings = active
    .filter((location) => location.type === "Building" || location.type === "Facility")
    .filter((location) => (seenNames.has(location.name) ? false : (seenNames.add(location.name), true)))
    .map((location) => ({ location, order: rand() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, 30)
    .map((entry) => entry.location);
  const indoor = active.filter((location) => (INDOOR_TYPES as string[]).includes(location.type));

  const zipf = buildings.map((_, index) => 1 / (index + 1) ** 0.85);
  const zipfTotal = zipf.reduce((sum, value) => sum + value, 0) || 1;
  const destinations: Destination[] = buildings.map((location, index) => ({
    id: locationIdentityKey(location),
    name: location.name,
    context: location.type === "Facility" ? "Facility" : "Building",
    type: "Building",
    weight: (1 - INDOOR_TRAFFIC_SHARE) * (zipf[index] / zipfTotal),
    arrival: 0.85 + (rand() - 0.5) * 0.12,
  }));
  for (const type of INDOOR_TYPES) {
    const group = indoor.filter((location) => location.type === type);
    group.forEach((location) =>
      destinations.push({
        id: locationIdentityKey(location),
        name: location.name,
        context: location.building ? `${type} · ${location.building}` : type,
        type,
        weight: (INDOOR_TRAFFIC_SHARE * INDOOR_TYPE_SHARE[type]) / group.length,
        arrival: 0.85 + (rand() - 0.5) * 0.12,
      }),
    );
  }
  // A few well-searched destinations that users often fail to reach.
  const byWeight = [...destinations].sort((a, b) => b.weight - a.weight);
  [1, 4, 9].forEach((rank, index) => {
    if (byWeight[rank]) byWeight[rank].arrival = [0.48, 0.52, 0.5][index];
  });
  return destinations;
};

const hourShares = (() => {
  const raw: number[] = Array(24).fill(0);
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) {
    const mid = hour + 0.5;
    raw[hour] = 0.02 + HOUR_PEAKS.reduce((sum, [center, weight]) => sum + weight * Math.exp(-((mid - center) ** 2) / (2 * 0.9 ** 2)), 0);
  }
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
})();

/** Split `total` across `weights` with integer parts that sum to exactly `total`. */
const allocate = (total: number, weights: number[]) => {
  const sum = weights.reduce((acc, value) => acc + value, 0) || 1;
  const parts = weights.map((weight) => Math.floor((total * weight) / sum));
  let remainder = total - parts.reduce((acc, value) => acc + value, 0);
  const largest = weights.indexOf(Math.max(...weights));
  if (largest >= 0) parts[largest] += remainder;
  return parts;
};

const buildModel = (locations: Location[], todayNumber: number): Model => {
  const destinations = buildDestinations(locations);
  const firstDay = todayNumber - HISTORY_DAYS + 1;

  // Registrations first: user count on each day is derived from them.
  const registrations = Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const dayNumber = firstDay + index;
    const rand = seededRandom(dayNumber, 1);
    const weekend = weekdayOf(dayNumber) >= 5 ? 0.4 : 1;
    const expected = (0.4 + 1.6 * Math.exp(-index / 14)) * weekend * (0.7 + 0.6 * rand());
    return { dayNumber, expected, rand };
  });
  const scale = 210 / registrations.reduce((sum, entry) => sum + entry.expected, 0);
  const regCounts = registrations.map(({ expected, rand }) => {
    const count = Math.round(expected * scale);
    const result: Record<UserAccountType, number> = { student: 0, teacher: 0, visitor: 0 };
    for (let i = 0; i < count; i += 1) {
      const roll = rand();
      result[roll < 0.84 ? "student" : roll < 0.92 ? "teacher" : "visitor"] += 1;
    }
    return result;
  });
  const registeredInWindow = regCounts.reduce((sum, entry) => sum + entry.student + entry.teacher + entry.visitor, 0);
  let users = TARGET_USERS - registeredInWindow;

  const days: Day[] = registrations.map(({ dayNumber }, index) => {
    const reg = regCounts[index];
    users += reg.student + reg.teacher + reg.visitor;
    const weekday = weekdayOf(dayNumber);
    const rand = seededRandom(dayNumber, 2);
    const dayTotal = (users / 100) * 40 * WEEKDAY_FACTOR[weekday] * (0.85 + 0.3 * rand());
    const hourly: number[] = Array(24).fill(0);
    for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) hourly[hour] = Math.round(dayTotal * hourShares[hour] * (0.82 + 0.36 * rand()));
    const searches = hourly.reduce((sum, value) => sum + value, 0);

    const destSearches = allocate(searches, destinations.map((destination) => destination.weight * (0.7 + 0.6 * rand())));
    const destVisits = destSearches.map((count, i) => Math.min(count, Math.round(count * destinations[i].arrival * (0.95 + 0.1 * rand()))));
    const visits = destVisits.reduce((sum, value) => sum + value, 0);

    const teacher = Math.round(visits * ACCOUNT_SHARE.teacher * (0.85 + 0.3 * rand()));
    const visitor = Math.round(visits * ACCOUNT_SHARE.visitor * (0.85 + 0.3 * rand()));
    const student = Math.max(0, visits - teacher - visitor);

    // Stable user IDs let period totals count distinct signed-in users with a Search.
    const activeUsers = new Set<number>();
    for (let search = 0; search < searches; search += 1) {
      if (rand() < SIGNED_IN_SHARE) activeUsers.add(Math.floor(rand() * users));
    }

    return {
      date: dayToDate(dayNumber),
      weekday,
      activeUsers: [...activeUsers],
      hourly,
      searches,
      visits,
      visitsByAccount: { student, teacher, visitor },
      destSearches,
      destVisits,
      registrations: reg,
    };
  });
  return { days, destinations };
};

const totalsOf = (days: Day[]): AnalyticsTotals => {
  const searches = days.reduce((sum, day) => sum + day.searches, 0);
  const visits = days.reduce((sum, day) => sum + day.visits, 0);
  const activeUsers = new Set(days.flatMap((day) => day.activeUsers)).size;
  return { activeUsers, searches, visits, arrivalRate: searches ? visits / searches : 0 };
};

/** Daily buckets for week/month, 7-day buckets (ending today) for all time. */
const bucketize = <T>(days: Day[], size: number, build: (bucket: Day[]) => T): T[] => {
  const buckets: T[] = [];
  for (let start = 0; start < days.length; start += size) buckets.push(build(days.slice(start, start + size)));
  return buckets;
};

const buildCompleteness = (locations: Location[], buildings: Building[]): { checks: CompletenessCheck[]; total: number } => {
  const scope = locations.filter(
    (location) =>
      location.status === "Active" &&
      ["Building", "Facility", ...INDOOR_TYPES].includes(location.type),
  );
  const footprints = new Map(buildings.map((building) => [building.id, building.points]));
  const counts = { photo: 0, description: 0, keywords: 0, mapPin: 0 };
  for (const location of scope) {
    if (location.hasPhoto || location.photo) counts.photo += 1;
    if (location.function?.trim()) counts.description += 1;
    if (location.keywords?.trim()) counts.keywords += 1;
    const hasPin = location.lat != null && location.lng != null;
    const hasPolygon = (location.type === "Building" || location.type === "Facility") && ((location.polygonCoordinates ?? footprints.get(location.id))?.length ?? 0) >= 3;
    if (hasPin || hasPolygon) counts.mapPin += 1;
  }
  const total = scope.length;
  return {
    total,
    checks: [
      { key: "photo", label: "Photo", complete: counts.photo, total },
      { key: "description", label: "Description", complete: counts.description, total },
      { key: "keywords", label: "Search keywords", complete: counts.keywords, total },
      { key: "mapPin", label: "Map pin", complete: counts.mapPin, total },
    ],
  };
};

export function generateDashboardAnalytics(range: DashboardRange, locations: Location[], now = Date.now(), buildings: Building[] = []): DashboardAnalytics {
  const model = buildModel(locations, manilaDayNumber(now));
  const { days, destinations } = model;
  const length = range === "week" ? 7 : range === "month" ? 30 : days.length;
  const current = days.slice(days.length - length);
  const previous = range === "all" ? null : days.slice(days.length - 2 * length, days.length - length);
  const bucketSize = range === "all" ? 7 : 1;

  const sumBy = (selector: (day: Day) => number) => current.reduce((sum, day) => sum + selector(day), 0);

  const visitsByDestinationType: Record<DestinationType, number> = { Building: 0, Room: 0, Laboratory: 0, Office: 0, Restroom: 0 };
  const destTotals = destinations.map((destination, index) => {
    const searches = sumBy((day) => day.destSearches[index]);
    const visits = sumBy((day) => day.destVisits[index]);
    visitsByDestinationType[destination.type] += visits;
    return { destination, searches, visits };
  });
  const topDestinations: AnalyticsDestination[] = destTotals
    .filter((entry) => entry.searches > 0)
    .sort((a, b) => b.searches - a.searches)
    .slice(0, 8)
    .map(({ destination, searches, visits }, index) => ({
      rank: String(index + 1),
      locationId: destination.id,
      name: destination.name,
      context: destination.context,
      searches,
      visits,
    }));

  const completeness = buildCompleteness(locations, buildings);
  return {
    range,
    current: totalsOf(current),
    previous: previous ? totalsOf(previous) : null,
    timeline: bucketize(current, bucketSize, (bucket) => ({
      date: bucket[0].date,
      searches: bucket.reduce((sum, day) => sum + day.searches, 0),
      visits: bucket.reduce((sum, day) => sum + day.visits, 0),
    })),
    visitsByAccountType: {
      student: sumBy((day) => day.visitsByAccount.student),
      teacher: sumBy((day) => day.visitsByAccount.teacher),
      visitor: sumBy((day) => day.visitsByAccount.visitor),
    },
    visitsByDestinationType,
    registrations: bucketize(current, bucketSize, (bucket) => ({
      date: bucket[0].date,
      student: bucket.reduce((sum, day) => sum + day.registrations.student, 0),
      teacher: bucket.reduce((sum, day) => sum + day.registrations.teacher, 0),
      visitor: bucket.reduce((sum, day) => sum + day.registrations.visitor, 0),
    })),
    topDestinations,
    completeness: completeness.checks,
    completenessTotal: completeness.total,
  };
}
