import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../../../types";
import { ChartArea } from "../ChartCard";
import { AXIS_TICK, ALERT, INK, SERIES, TOOLTIP_STYLE, TRACK } from "../palette";
import { RowLabelTick } from "./RowLabelTick";

const DROP_RATIO = 0.7;
const FAIL_ROUTES = 20;

type BarRow = { label: string; value: number; color: string; note: string };

/** Horizontal ranked bars on a pale track, value after each bar. */
function RankedBars({ rows, height, max, labelWidth, unit }: { rows: BarRow[]; height: number; max: number; labelWidth: number; unit: string }) {
  return (
    <ChartArea height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 30, bottom: 2, left: 0 }} barCategoryGap={5}>
        <XAxis type="number" hide domain={[0, max]} />
        <YAxis type="category" dataKey="label" tick={<RowLabelTick />} tickLine={false} axisLine={false} width={labelWidth} interval={0} />
        <Tooltip
          cursor={false}
          contentStyle={TOOLTIP_STYLE}
          separator=""
          formatter={(value, _name, item) => [`${value} ${unit}${(item.payload as BarRow).note}`, ""]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} background={{ fill: TRACK, radius: 4 }} minPointSize={3} isAnimationActive={false}>
          {rows.map((row) => <Cell key={row.label} fill={row.color} />)}
          <LabelList dataKey="value" position="right" fontSize={11} fill={INK.primary} />
        </Bar>
      </BarChart>
    </ChartArea>
  );
}

/** #1 Readiness: cumulative funnel; a bar is red when it falls below 70% of the bar above it. */
export function PlaceFunnel({ data }: { data: DecisionAnalytics }) {
  const rows: BarRow[] = data.funnel.map((step, i) => {
    const prev = i > 0 ? data.funnel[i - 1].count : null;
    const drop = prev !== null && step.count < prev * DROP_RATIO;
    return {
      label: step.label,
      value: step.count,
      color: drop ? ALERT : SERIES.blue,
      note: prev === null ? "" : ` · ${Math.round((step.count / prev) * 100)}% of the step above${drop ? " (big drop)" : ""}`,
    };
  });
  return <RankedBars rows={rows} height={170} max={data.funnel[0].count} labelWidth={100} unit="places" />;
}

/** #2 Readiness: routes broken if the pathway closes; red from 20 up. */
export function SinglePointsOfFailure({ data }: { data: DecisionAnalytics }) {
  const rows: BarRow[] = [...data.singlePoints]
    .sort((a, b) => b.routesBroken - a.routesBroken)
    .map((row) => ({
      label: row.pathway,
      value: row.routesBroken,
      color: row.routesBroken >= FAIL_ROUTES ? ALERT : SERIES.blue,
      note: row.routesBroken >= FAIL_ROUTES ? " (cuts places off)" : "",
    }));
  return <RankedBars rows={rows} height={150} max={Math.max(...rows.map((r) => r.value))} labelWidth={112} unit="walking routes broken if closed" />;
}

/** #3 Readiness: one square per routable place, filled when the travel mode reaches it. */
export function TravelModeReach({ data }: { data: DecisionAnalytics }) {
  const { total, modes } = data.reach;
  return (
    <div className="reach">
      {modes.map((row) => (
        <div className="reach-row" key={row.mode}>
          <span className="reach-name">{row.mode}</span>
          <div className="reach-squares" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
            {Array.from({ length: total }, (_, k) => (
              <i key={k} className={k < row.reachable ? "on" : undefined} title={`${row.mode}: ${row.reachable} of ${total} reachable`} />
            ))}
          </div>
          <b>{row.reachable}/{total}</b>
        </div>
      ))}
    </div>
  );
}
