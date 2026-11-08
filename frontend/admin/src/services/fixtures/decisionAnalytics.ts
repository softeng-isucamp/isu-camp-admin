import type { DashboardRange, DecisionAnalytics } from "../../types";
import { mulberry32 } from "./prng";

/**
 * Fixture numbers for the decision-support charts (approved mockup "grouped").
 * Week is the mockup's baseline. Month and all-time scale the usage-based numbers
 * (searches, edits, heatmap) so the range selector visibly does something;
 * readiness, pathways, travel-mode reach and the audience split stay fixed.
 */
const SEARCH_SCALE: Record<DashboardRange, number> = { week: 1, month: 1.6, all: 2.5 };
const EDIT_SCALE: Record<DashboardRange, number> = { week: 1, month: 1.3, all: 1.8 };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/** Weekdays follow a morning-and-afternoon curve with a lunch dip; the weekend is quiet, Sat 7:00-11:00 quietest. */
const heatmapCells = (scale: number): number[][] => {
  const jitter = mulberry32(2026);
  const weekday = (dayFactor: number) =>
    HOURS.map((hour) => {
      const curve = Math.sin(((hour - 6) / 13) * Math.PI) * (hour === 12 ? 0.7 : 1) + (hour === 8 ? 0.25 : 0);
      return Math.max(2, Math.round(40 * curve * dayFactor * (0.75 + 0.25 * jitter())));
    });
  const saturday = [3, 1, 1, 1, 2, 4, 5, 5, 4, 4, 3, 3, 2, 2];
  const sunday = [3, 3, 2, 3, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2];
  return [weekday(1), weekday(0.95), weekday(1), weekday(0.9), weekday(0.8), saturday, sunday].map((row) =>
    row.map((value) => Math.max(1, Math.round(value * scale))),
  );
};

export function generateDecisionAnalytics(range: DashboardRange): DecisionAnalytics {
  const s = SEARCH_SCALE[range];
  const e = EDIT_SCALE[range];
  const searches = (n: number) => Math.round(n * s);
  return {
    range,
    fixFirst: [
      ["Registrar", 92, 25], ["CCSICT", 73, 38], ["Main Library", 63, 0], ["Cashier", 48, 25],
      ["Clinic", 40, 75], ["Gym", 30, 100], ["CAS", 58, 100], ["Canteen", 80, 100],
      ["Old CA", 12, 25], ["De Venecia", 9, 0], ["Admin Bldg", 47, 75], ["Nursing", 22, 50],
      ["Vetmed", 18, 75], ["ISU Oval", 6, 50], ["CED", 35, 100], ["Guard house", 4, 25],
    ].map(([name, count, ready]) => ({ name: name as string, searches: searches(count as number), ready: ready as number })),
    indoorDemand: [
      { building: "Registrar bldg", searches: searches(92), hasRooms: true },
      { building: "CCSICT", searches: searches(71), hasRooms: false },
      { building: "CAS", searches: searches(58), hasRooms: true },
      { building: "Admin Bldg", searches: searches(48), hasRooms: false },
      { building: "Nursing", searches: searches(22), hasRooms: true },
      { building: "Vetmed", searches: searches(18), hasRooms: false },
    ],
    effort: [
      ["Canteen", 3, 77], ["Registrar", 2, 92], ["CCSICT", 4, 71], ["Gym", 21, 30], ["ISU Oval", 17, 6], ["Main Library", 1, 64],
    ].map(([place, edits, count]) => ({ place: place as string, edits: Math.round((edits as number) * e), searches: searches(count as number) })),
    funnel: [
      { key: "active", label: "Active places", count: 48 },
      { key: "onMap", label: "On user map", count: 48 },
      { key: "description", label: "Has description", count: 48 },
      { key: "photo", label: "Has photo", count: 31 },
      { key: "routable", label: "Routable", count: 16 },
      { key: "indoor", label: "Has indoor rooms", count: 4 },
    ],
    singlePoints: [
      { pathway: "Junction → CCSICT", routesBroken: 30 },
      { pathway: "Infirmary entrance", routesBroken: 24 },
      { pathway: "Old CA spur", routesBroken: 19 },
      { pathway: "To Junction X", routesBroken: 12 },
      { pathway: "Gate road", routesBroken: 6 },
    ],
    reach: {
      total: 16,
      modes: [
        { mode: "Walking", reachable: 15 },
        { mode: "Bicycle", reachable: 11 },
        { mode: "Motorcycle", reachable: 7 },
        { mode: "Car", reachable: 6 },
      ],
    },
    heatmap: { days: DAYS, hours: HOURS, cells: heatmapCells(s) },
    movers: [
      { name: "Registrar", lastMonth: 30, thisMonth: 92 },
      { name: "Cashier", lastMonth: 25, thisMonth: 55 },
      { name: "Gym", lastMonth: 44, thisMonth: 30 },
      { name: "Canteen", lastMonth: 70, thisMonth: 77 },
      { name: "Clinic", lastMonth: 38, thisMonth: 40 },
    ],
    audience: [
      { category: "College", student: 62, teacher: 30, visitor: 8 },
      { category: "Offices", student: 35, teacher: 25, visitor: 40 },
      { category: "Food", student: 70, teacher: 22, visitor: 8 },
      { category: "Facility", student: 40, teacher: 45, visitor: 15 },
    ],
  };
}
