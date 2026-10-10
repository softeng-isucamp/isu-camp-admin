import type { DashboardAnalytics } from "../../../types";
import { ChartCard } from "./ChartCard";
import { formatNumber, formatPercent, rangePhrase } from "./format";

type Tile = { label: string; hint: string; value: string; change: { text: string; direction: number } | null };

const relativeChange = (current: number, previous: number) => {
  if (previous === 0) return null;
  const ratio = (current - previous) / previous;
  return { text: `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`, direction: Math.sign(ratio) };
};

const tilesOf = (data: DashboardAnalytics): Tile[] => {
  const { current, previous } = data;
  return [
    {
      label: "Active users",
      hint: "Signed-in users who previewed or started a route",
      value: formatNumber(current.activeUsers),
      change: previous ? relativeChange(current.activeUsers, previous.activeUsers) : null,
    },
    {
      label: "Total visits",
      hint: "Arrivals after a route preview or navigation start",
      value: formatNumber(current.visits),
      change: previous ? relativeChange(current.visits, previous.visits) : null,
    },
    {
      label: "Arrival rate",
      hint: "Visits divided by Searches",
      value: formatPercent(current.arrivalRate, 1),
      change: previous ? relativeChange(current.arrivalRate, previous.arrivalRate) : null,
    },
  ];
};

/** A4: headline KPI tiles with change versus the previous equal period (hidden for all time). */
export function ActivityKpis({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Usage at a glance"
      subtitle={data ? `Activity ${rangePhrase(data.range)}${data.previous ? ", compared with the previous equal period." : "."}` : "Active users, visits, and arrival rate."}
      data={data}
      isEmpty={(d) => d.current.searches === 0}
      className="analytics-wide"
    >
      {(d) => (
        <div className="analytics-kpis">
          {tilesOf(d).map((tile) => (
            <div className="analytics-kpi" key={tile.label}>
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
              <small>{tile.hint}</small>
              {tile.change && (
                <em className={tile.change.direction > 0 ? "up" : tile.change.direction < 0 ? "down" : ""} aria-label={`${tile.change.text} versus previous period`}>
                  {tile.change.direction > 0 ? "▲" : tile.change.direction < 0 ? "▼" : "■"} {tile.change.text} <i>vs previous</i>
                </em>
              )}
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
