import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { accountTypes } from "../../lib/accountType";
import type { DecisionAnalytics, DestinationType } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { formatNumber, formatPercent } from "../dashboard/analytics/format";
import { AXIS_TICK, INK, SERIES, TOOLTIP_STYLE } from "../dashboard/analytics/palette";
import { ClickTip } from "./ClickTip";

/** Same layout as the Dashboard's "Visits by account type", fed by recorded searches. A bar opens that account type in User Management. */
export function SearchesByAccountType({ data }: { data: DecisionAnalytics }) {
  const navigate = useNavigate();
  const { total, byAccountType } = data.searches;
  const rows = accountTypes.map((type) => ({ key: type.key, name: type.label, value: byAccountType[type.key], color: type.color }));
  return (
    <>
      <ChartArea height={220}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 92, bottom: 4, left: 8 }} barCategoryGap={18}>
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: INK.primary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: INK.grid }} width={70} />
          <Tooltip
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
              if (!row) return null;
              return <ClickTip title={row.name} value={`${formatNumber(row.value)} searches (${formatPercent(row.value / (total || 1))})`} action={`see ${row.name.toLowerCase()} accounts`} />;
            }}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={30}
            cursor="pointer"
            onClick={(entry) => {
              const key = (entry as { payload?: { key?: string } } | undefined)?.payload?.key;
              if (key) navigate(`/users?${new URLSearchParams({ userType: key })}`);
            }}
            isAnimationActive={false}
          >
            {rows.map((row) => <Cell key={row.key} fill={row.color} />)}
            <LabelList dataKey="value" position="right" fontSize={12} fill={INK.secondary} formatter={(value) => `${formatNumber(Number(value))} · ${formatPercent(Number(value) / (total || 1))}`} />
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}

/** Where a destination type opens: indoor types filter Locations by type; Places open the whole directory. */
const typeLink = (key: DestinationType) => (key === "Building" ? "/locations" : `/locations?${new URLSearchParams({ type: key })}`);

const TYPES: Array<{ key: DestinationType; label: string; color: string }> = [
  { key: "Building", label: "Places", color: SERIES.blue },
  { key: "Room", label: "Rooms", color: SERIES.orange },
  { key: "Laboratory", label: "Laboratories", color: SERIES.aqua },
  { key: "Office", label: "Offices", color: SERIES.yellow },
  { key: "Restroom", label: "Restrooms", color: SERIES.magenta },
];

/** Same donut and legend as the Dashboard's "Visits by destination type", fed by recorded searches. */
export function SearchesByDestinationType({ data }: { data: DecisionAnalytics }) {
  const navigate = useNavigate();
  const { byDestinationType } = data.searches;
  const rows = TYPES.map((type) => ({ ...type, value: byDestinationType[type.key] })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="analytics-donut">
      <div className="analytics-donut-chart">
        <ChartArea height={220}>
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={2} stroke={INK.surface} strokeWidth={2} cornerRadius={4} cursor="pointer" onClick={(_entry, index) => { const row = rows[index]; if (row) navigate(typeLink(row.key)); }} isAnimationActive={false}>
              {rows.map((row) => <Cell key={row.key} fill={row.color} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${formatNumber(Number(value))} (${formatPercent(Number(value) / (total || 1))})`, String(name)]} />
          </PieChart>
        </ChartArea>
        <div className="analytics-donut-total"><strong>{formatNumber(total)}</strong><small>searches</small></div>
      </div>
      <ul className="account-type-legend">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className="analytics-legend-row" onClick={() => navigate(typeLink(row.key))}>
              <i style={{ background: row.color }} aria-hidden="true" />
              <span>{row.label}</span>
              <b>{formatPercent(row.value / (total || 1))}</b>
              <small>{formatNumber(row.value)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
