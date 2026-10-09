import type { DashboardAnalytics } from "../../../types";
import { ChartCard } from "./ChartCard";
import { formatNumber } from "./format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LOW = [232, 243, 236];
const HIGH = [0, 89, 49]; // brand green

const shade = (ratio: number) => {
  const t = Math.max(0, Math.min(1, ratio));
  return `rgb(${LOW.map((low, i) => Math.round(low + (HIGH[i] - low) * t)).join(",")})`;
};
const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "a" : "p"}`;

/** A2: Searches by weekday and hour of day (Asia/Manila). Plain CSS grid; Recharts has no heatmap. */
export function PeakHoursHeatmap({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Peak hours"
      subtitle="Searches by weekday and hour of day (Asia/Manila). Darker means busier."
      data={data}
      isEmpty={(d) => d.peakHours.every((cell) => cell.searches === 0)}
      className="analytics-wide"
    >
      {(d) => {
        const hours = [...new Set(d.peakHours.map((cell) => cell.hour))].sort((a, b) => a - b);
        const max = Math.max(...d.peakHours.map((cell) => cell.searches), 1);
        const lookup = new Map(d.peakHours.map((cell) => [`${cell.day}:${cell.hour}`, cell.searches]));
        return (
          <div className="heatmap" role="table" aria-label="Searches by weekday and hour" style={{ gridTemplateColumns: `36px repeat(${hours.length}, minmax(0, 1fr))` }}>
            <span />
            {hours.map((hour) => <small key={hour} className="heatmap-hour" role="columnheader">{hourLabel(hour)}</small>)}
            {DAYS.map((label, day) => (
              <div key={label} role="row" style={{ display: "contents" }}>
                <small className="heatmap-day" role="rowheader">{label}</small>
                {hours.map((hour) => {
                  const value = lookup.get(`${day}:${hour}`) ?? 0;
                  return (
                    <i
                      key={hour}
                      className="heatmap-cell"
                      role="cell"
                      style={{ background: shade(value / max) }}
                      title={`${label} ${hourLabel(hour)}: ${formatNumber(value)} searches`}
                      aria-label={`${label} ${hourLabel(hour)}: ${formatNumber(value)} searches`}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            <div className="heatmap-scale" style={{ gridColumn: `2 / span ${hours.length}` }}>
              <small>Fewer</small>
              <i style={{ background: `linear-gradient(90deg, ${shade(0)}, ${shade(1)})` }} />
              <small>More ({formatNumber(max)} max)</small>
            </div>
          </div>
        );
      }}
    </ChartCard>
  );
}
