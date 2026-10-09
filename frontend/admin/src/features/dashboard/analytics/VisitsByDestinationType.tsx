import { Cell, Pie, PieChart, Tooltip } from "recharts";
import type { DashboardAnalytics, DestinationType } from "../../../types";
import { ChartArea, ChartCard } from "./ChartCard";
import { formatNumber, formatPercent } from "./format";
import { INK, SERIES, TOOLTIP_STYLE } from "./palette";

const TYPES: Array<{ key: DestinationType; color: string }> = [
  { key: "Building", color: SERIES.blue },
  { key: "Room", color: SERIES.orange },
  { key: "Laboratory", color: SERIES.aqua },
  { key: "Office", color: SERIES.yellow },
  { key: "Restroom", color: SERIES.magenta },
];

/** A6: Visits by Destination type (Building, Room, Laboratory, Office, Restroom). */
export function VisitsByDestinationType({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Visits by destination type"
      subtitle="Share of Visits by kind of Destination. Indoor Locations count toward their own type."
      data={data}
      isEmpty={(d) => Object.values(d.visitsByDestinationType).every((value) => value === 0)}
    >
      {(d) => {
        const rows = TYPES.map((type) => ({ name: type.key, value: d.visitsByDestinationType[type.key], color: type.color }));
        const total = rows.reduce((sum, row) => sum + row.value, 0);
        return (
          <div className="analytics-donut">
            <div className="analytics-donut-chart">
              <ChartArea height={200}>
                <PieChart>
                  <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke={INK.surface} strokeWidth={2} cornerRadius={4}>
                    {rows.map((row) => <Cell key={row.name} fill={row.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${formatNumber(Number(value))} (${formatPercent(Number(value) / (total || 1))})`, String(name)]} />
                </PieChart>
              </ChartArea>
              <div className="analytics-donut-total"><strong>{formatNumber(total)}</strong><small>visits</small></div>
            </div>
            <ul className="account-type-legend">
              {rows.map((row) => (
                <li key={row.name}>
                  <div className="analytics-legend-row">
                    <i style={{ background: row.color }} aria-hidden="true" />
                    <span>{row.name}</span>
                    <b>{formatPercent(row.value / (total || 1))}</b>
                    <small>{formatNumber(row.value)}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </ChartCard>
  );
}
