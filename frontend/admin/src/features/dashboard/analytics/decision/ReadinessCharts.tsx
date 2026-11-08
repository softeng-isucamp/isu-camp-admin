import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../../../types";
import { ChartArea } from "../ChartCard";
import { AXIS_TICK, ALERT, INK, SERIES, TOOLTIP_STYLE } from "../palette";
import { RowLabelTick } from "./RowLabelTick";

const DROP_RATIO = 0.7;
const FAIL_ROUTES = 20;

const axisTitle = (value: string, offset = -14) => ({ value, position: "insideBottom" as const, offset, fill: INK.secondary, fontSize: 12 });

/** #1 Readiness: cumulative funnel as columns; a column is red when it keeps less than 70% of the column before it. */
export function PlaceFunnel({ data }: { data: DecisionAnalytics }) {
  const rows = data.funnel.map((step, i) => {
    const prev = i > 0 ? data.funnel[i - 1].count : null;
    const kept = prev ? Math.round((step.count / prev) * 100) : 100;
    return { ...step, kept, drop: prev !== null && step.count < prev * DROP_RATIO };
  });
  const yMax = Math.ceil(data.funnel[0].count / 10) * 10;
  const yTicks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10);
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: SERIES.blue }} /> Places that pass this step</span>
        <span><i style={{ background: ALERT }} /> Big drop from the step before</span>
      </div>
      <ChartArea height={340}>
        <BarChart data={rows} margin={{ top: 26, right: 16, bottom: 6, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={INK.grid} />
          <XAxis dataKey="label" tick={{ ...AXIS_TICK, fill: INK.primary, fontSize: 12 }} tickLine={false} axisLine={{ stroke: INK.grid }} interval={0} />
          <YAxis domain={[0, yMax]} ticks={yTicks} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} label={{ value: "Places", angle: -90, position: "insideLeft", offset: 10, style: { textAnchor: "middle" }, fill: INK.secondary, fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "#f3f6f4" }}
            contentStyle={TOOLTIP_STYLE}
            separator=""
            formatter={(value, _name, item) => {
              const row = item.payload as (typeof rows)[number];
              return [`${value} places${row.kept < 100 ? ` · ${row.kept}% of the step before` : ""}`, ""];
            }}
          />
          <Bar dataKey="count" radius={[5, 5, 0, 0]} minPointSize={3} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.key} fill={row.drop ? ALERT : SERIES.blue} />)}
            <LabelList
              dataKey="count"
              position="top"
              content={({ x, y, width, index }) => {
                const row = rows[Number(index)];
                if (!row) return null;
                const cx = Number(x) + Number(width) / 2;
                return (
                  <text x={cx} y={Number(y) - 8} textAnchor="middle" fontSize={12} fill={INK.primary}>
                    <tspan fontWeight={700}>{row.count}</tspan>
                    {row.kept < 100 && <tspan fill={row.drop ? ALERT : INK.muted}>{`  ${row.kept}%`}</tspan>}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}

/** #2 Readiness: routes broken if the pathway closes; red from 20 up, with the threshold drawn as a line. */
export function SinglePointsOfFailure({ data }: { data: DecisionAnalytics }) {
  const rows = [...data.singlePoints].sort((a, b) => b.routesBroken - a.routesBroken);
  const max = Math.ceil(Math.max(...rows.map((r) => r.routesBroken)) / 10) * 10;
  return (
    <ChartArea height={290}>
      <BarChart data={rows} layout="vertical" margin={{ top: 22, right: 32, bottom: 22, left: 0 }} barCategoryGap="24%">
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" domain={[0, max]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={axisTitle("Walking routes broken if closed")} />
        <YAxis type="category" dataKey="pathway" tick={<RowLabelTick />} tickLine={false} axisLine={{ stroke: INK.grid }} width={128} interval={0} />
        <ReferenceLine x={FAIL_ROUTES} stroke={ALERT} strokeDasharray="4 4" label={{ value: "cuts places off", position: "top", fill: ALERT, fontSize: 11 }} />
        <Tooltip cursor={{ fill: "#f3f6f4" }} contentStyle={TOOLTIP_STYLE} separator="" formatter={(value) => [`${value} routes broken if closed`, ""]} />
        <Bar dataKey="routesBroken" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((row) => <Cell key={row.pathway} fill={row.routesBroken >= FAIL_ROUTES ? ALERT : SERIES.blue} />)}
          <LabelList dataKey="routesBroken" position="right" fontSize={11} fill={INK.primary} />
        </Bar>
      </BarChart>
    </ChartArea>
  );
}

/** #3 Readiness: routable places each travel mode reaches, against the total drawn as a line. */
export function TravelModeReach({ data }: { data: DecisionAnalytics }) {
  const { total, modes } = data.reach;
  const step = total <= 20 ? 4 : 10;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <ChartArea height={290}>
      <BarChart data={modes} layout="vertical" margin={{ top: 22, right: 44, bottom: 22, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" domain={[0, total]} ticks={ticks} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={axisTitle("Routable places reached")} />
        <YAxis type="category" dataKey="mode" tick={<RowLabelTick />} tickLine={false} axisLine={{ stroke: INK.grid }} width={86} interval={0} />
        <ReferenceLine x={total} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `all ${total}`, position: "top", fill: INK.secondary, fontSize: 11 }} />
        <Tooltip cursor={{ fill: "#f3f6f4" }} contentStyle={TOOLTIP_STYLE} separator="" formatter={(value) => [`${value} of ${total} places reachable`, ""]} />
        <Bar dataKey="reachable" fill={SERIES.blue} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="reachable" position="right" fontSize={11} fill={INK.primary} formatter={(value) => `${String(value)}/${total}`} />
        </Bar>
      </BarChart>
    </ChartArea>
  );
}
