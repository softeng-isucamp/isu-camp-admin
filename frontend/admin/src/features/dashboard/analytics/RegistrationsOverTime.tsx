import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { accountTypes } from "../../../lib/accountType";
import type { DashboardAnalytics } from "../../../types";
import { ChartArea, ChartCard } from "./ChartCard";
import { formatBucket, formatBucketDate, formatNumber } from "./format";
import { AXIS_TICK, INK, TOOLTIP_STYLE } from "./palette";

/** B1: New registrations over time, stacked by account type. */
export function RegistrationsOverTime({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="New registrations"
      subtitle={data?.range === "all" ? "Weekly sign-ups by account type." : "Daily sign-ups by account type."}
      data={data}
      isEmpty={(d) => d.registrations.every((entry) => entry.student + entry.teacher + entry.visitor === 0)}
      emptyMessage="No new registrations in this period."
      className="analytics-wide"
    >
      {(d) => (
        <ChartArea height={260}>
          <BarChart data={d.registrations} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="date" tickFormatter={formatBucketDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
            <Tooltip cursor={{ fill: "#f3f6f4" }} contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatBucket(String(label), d.range)} formatter={(value) => formatNumber(Number(value))} />
            <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} />
            {accountTypes.map((type, index) => (
              <Bar
                key={type.key}
                dataKey={type.key}
                name={type.label}
                stackId="registrations"
                fill={type.color}
                stroke={INK.surface}
                strokeWidth={1}
                maxBarSize={28}
                radius={index === accountTypes.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ChartArea>
      )}
    </ChartCard>
  );
}
