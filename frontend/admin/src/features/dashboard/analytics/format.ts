import type { DashboardAnalytics, DashboardRange } from "../../../types";

const manilaDate = (date: string) => new Date(`${date}T12:00:00+08:00`);

/** Axis/tooltip label for an Asia/Manila `YYYY-MM-DD` bucket start, e.g. "Sep 18". */
export const formatBucketDate = (date: string) =>
  manilaDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

export const formatBucket = (date: string, range: DashboardRange) =>
  range === "all" ? `Week of ${formatBucketDate(date)}` : formatBucketDate(date);

export const formatNumber = (value: number) => value.toLocaleString();
export const formatPercent = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`;

/** Phrase completing "Activity ...", e.g. "over the last 7 days" or "across all time". */
export const rangePhrase = (range: DashboardRange) =>
  range === "week" ? "over the last 7 days" : range === "month" ? "over the last 30 days" : "across all time";

const formatFullDate = (date: string) =>
  manilaDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

/**
 * The dates the charts actually cover, from the timeline's bucket starts: the
 * first day through the last day for week and month, and "Since <first day>" for
 * all time, whose last bucket is a partial week ending today.
 */
export const formatAnalyticsPeriod = (data: Pick<DashboardAnalytics, "range" | "timeline">): string | null => {
  const first = data.timeline[0]?.date;
  const last = data.timeline.at(-1)?.date;
  if (!first || !last) return null;
  if (data.range === "all") return `Since ${formatFullDate(first)}`;
  const sameYear = manilaDate(first).getUTCFullYear() === manilaDate(last).getUTCFullYear();
  return `${sameYear ? formatBucketDate(first) : formatFullDate(first)} \u2013 ${formatFullDate(last)}`;
};
