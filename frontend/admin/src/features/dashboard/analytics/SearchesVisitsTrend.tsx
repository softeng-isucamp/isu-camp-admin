import { Area, AreaChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardAnalytics } from "../../../types";
import { ChartArea, ChartCard } from "./ChartCard";
import { formatBucket, formatBucketDate, formatNumber } from "./format";
import { AXIS_TICK, INK, SERIES, TOOLTIP_STYLE } from "./palette";

/** A1: Searches and Visits per day (per week for all time). */
export function SearchesVisitsTrend({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Searches & Visits"
      subtitle={data?.range === "all" ? "Weekly Searches and Visits." : "Daily Searches and Visits (Asia/Manila)."}
      data={data}
      isEmpty={(d) => d.timeline.every((point) => point.searches === 0)}
      className="analytics-wide"
    >
      {(d) => (
        <ChartArea height={280}>
          <AreaChart data={d.timeline} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="date" tickFormatter={formatBucketDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={formatNumber} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatBucket(String(label), d.range)} formatter={(value) => formatNumber(Number(value))} />
            <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} />
            <Area type="monotone" dataKey="searches" name="Searches" stroke={SERIES.blue} fill={SERIES.blue} fillOpacity={0.14} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: INK.surface, strokeWidth: 2 }} />
            <Area type="monotone" dataKey="visits" name="Visits" stroke={SERIES.orange} fill={SERIES.orange} fillOpacity={0.14} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: INK.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ChartArea>
      )}
    </ChartCard>
  );
}
