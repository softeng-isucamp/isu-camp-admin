import type { DashboardRange } from "../../../types";

const manilaDate = (date: string) => new Date(`${date}T12:00:00+08:00`);

/** Axis/tooltip label for an Asia/Manila `YYYY-MM-DD` bucket start, e.g. "Sep 18". */
export const formatBucketDate = (date: string) =>
  manilaDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

export const formatBucket = (date: string, range: DashboardRange) =>
  range === "all" ? `Week of ${formatBucketDate(date)}` : formatBucketDate(date);

export const formatNumber = (value: number) => value.toLocaleString();
export const formatPercent = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`;

export const rangeNoun = (range: DashboardRange) =>
  range === "week" ? "last 7 days" : range === "month" ? "last 30 days" : "last 12 weeks";
