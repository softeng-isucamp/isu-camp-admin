import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { accountTypes } from "../../../lib/accountType";
import type { DashboardAnalytics } from "../../../types";
import { ChartArea, ChartCard } from "./ChartCard";
import { formatNumber, formatPercent } from "./format";
import { AXIS_TICK, INK, TOOLTIP_STYLE } from "./palette";

/** A3: Visits split by account type. The User App records only signed-in users. */
export function VisitsByAccountType({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Visits by account type"
      subtitle="Who arrives at their Destination."
      data={data}
      isEmpty={(d) => Object.values(d.visitsByAccountType).every((value) => value === 0)}
    >
      {(d) => {
        const total = Object.values(d.visitsByAccountType).reduce((sum, value) => sum + value, 0);
        const rows = accountTypes.map((type) => ({ name: type.label, value: d.visitsByAccountType[type.key], color: type.color }));
        return (
          <ChartArea height={170}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 76, bottom: 0, left: 8 }} barCategoryGap={14}>
              <CartesianGrid horizontal={false} stroke={INK.grid} />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 12 }} tickLine={false} axisLine={false} width={80} />
              <Tooltip cursor={{ fill: "#f3f6f4" }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(Number(value))} (${formatPercent(Number(value) / (total || 1))})`, "Visits"]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
                {rows.map((row) => <Cell key={row.name} fill={row.color} />)}
                <LabelList dataKey="value" position="right" fontSize={12} fill={INK.secondary} formatter={(value) => `${formatNumber(Number(value))} · ${formatPercent(Number(value) / (total || 1))}`} />
              </Bar>
            </BarChart>
          </ChartArea>
        );
      }}
    </ChartCard>
  );
}
