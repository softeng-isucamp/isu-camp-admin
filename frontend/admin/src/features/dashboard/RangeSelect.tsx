import type { DashboardRange } from "../../types";

/** Completes "N searches …" or "added …" for a range, e.g. "this week" or "in 2025". */
export const rangeLabel = (range: DashboardRange) =>
  range === "week" ? "this week" : range === "month" ? "this month" : range.startsWith("year-") ? `in ${range.slice(5)}` : "all time";

const manilaYear = () => Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date()));

/**
 * The shared time-range picker: recent windows, every calendar year (Manila) from the first year
 * with recorded data up to this one, then all time. The Dashboard and Analytics pages both use it.
 */
export function RangeSelect({ value, onChange, firstYear, disabled, label }: {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
  /** The first year with any Search or registration; years before it would be empty. */
  firstYear?: number;
  disabled?: boolean;
  label: string;
}) {
  const currentYear = manilaYear();
  const first = Math.min(currentYear, Math.max(1900, firstYear ?? currentYear));
  const years = Array.from({ length: currentYear - first + 1 }, (_, index) => currentYear - index);
  return (
    <select
      className="dashboard-time-filter"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as DashboardRange)}
    >
      <optgroup label="Recent"><option value="week">This week</option><option value="month">This month</option></optgroup>
      <optgroup label="Calendar year">{years.map((year) => <option key={year} value={`year-${year}`}>{year === currentYear ? `This year (${year})` : year}</option>)}</optgroup>
      <option value="all">All time</option>
    </select>
  );
}
