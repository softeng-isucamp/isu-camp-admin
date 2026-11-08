import { Bar, BarChart, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { accountTypes } from "../../../../lib/accountType";
import type { DecisionAnalytics } from "../../../../types";
import { ChartArea } from "../ChartCard";
import { AXIS_TICK, INK, MUTED_MARK, SERIES, TOOLTIP_STYLE } from "../palette";
import { RowLabelTick } from "./RowLabelTick";

const WINDOW_HOURS = 4;
const RISE = 20;

/** The quietest run of `WINDOW_HOURS` consecutive hours in one day; the earliest wins a tie. */
function quietestWindow(cells: number[][]) {
  let best = { day: 0, start: 0, total: Infinity };
  cells.forEach((row, day) => {
    for (let start = 0; start + WINDOW_HOURS <= row.length; start += 1) {
      const total = row.slice(start, start + WINDOW_HOURS).reduce((sum, value) => sum + value, 0);
      if (total < best.total) best = { day, start, total };
    }
  });
  return best;
}

/** #1 User App: searches by weekday and hour in one blue hue, with the quietest window outlined and named. */
export function QuietHoursHeatmap({ data }: { data: DecisionAnalytics }) {
  const { days, hours, cells } = data.heatmap;
  const max = Math.max(...cells.flat());
  const quiet = quietestWindow(cells);
  const from = hours[quiet.start];
  const to = hours[quiet.start + WINDOW_HOURS - 1] + 1;
  return (
    <div className="heatmap">
      <div className="heatmap-hours" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }} aria-hidden="true">
        {hours.map((hour, i) => <span key={hour}>{i % 2 === 0 ? hour : ""}</span>)}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-days">{days.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="heatmap-cells" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)`, gridTemplateRows: `repeat(${days.length}, 1fr)` }}>
          {cells.flatMap((row, d) =>
            row.map((value, h) => (
              <i key={`${d}-${h}`} style={{ background: `rgba(42, 120, 214, ${(0.08 + 0.92 * (value / max)).toFixed(2)})` }} title={`${days[d]} ${hours[h]}:00 · ${value} searches`} />
            )),
          )}
          <b
            className="heatmap-quiet"
            style={{
              left: `${(quiet.start / hours.length) * 100}%`,
              width: `${(WINDOW_HOURS / hours.length) * 100}%`,
              top: `${(quiet.day / days.length) * 100}%`,
              height: `${100 / days.length}%`,
            }}
            title={`Quietest window: ${days[quiet.day]} ${from}:00–${to}:00 · ${quiet.total} searches`}
          />
        </div>
      </div>
      <p className="heatmap-caption">Quietest: <strong>{days[quiet.day]} {from}:00–{to}:00</strong></p>
    </div>
  );
}

/** #2 User App: slope chart from last month to this month; lines that rose by more than 20 are highlighted. */
export function MoversSlope({ data }: { data: DecisionAnalytics }) {
  const rows = [
    { period: "Last month", ...Object.fromEntries(data.movers.map((m) => [m.name, m.lastMonth])) },
    { period: "This month", ...Object.fromEntries(data.movers.map((m) => [m.name, m.thisMonth])) },
  ];
  const max = Math.max(...data.movers.flatMap((m) => [m.lastMonth, m.thisMonth]));
  const ordered = [...data.movers].sort((a, b) => b.thisMonth - b.lastMonth - (a.thisMonth - a.lastMonth));
  return (
    <ChartArea height={190}>
      <LineChart data={rows} margin={{ top: 8, right: 86, bottom: 4, left: 14 }}>
        <XAxis dataKey="period" tick={AXIS_TICK} tickLine={false} axisLine={false} padding={{ left: 20, right: 20 }} />
        <YAxis hide domain={[0, Math.ceil(max / 10) * 10]} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: "#dbe5df" }}
          itemSorter={(item) => -(Number(item.value) || 0)}
          formatter={(value, name) => {
            const mover = data.movers.find((m) => m.name === name);
            const change = mover ? mover.thisMonth - mover.lastMonth : 0;
            return [`${value}${mover && change > RISE ? ` (+${change} this month)` : ""}`, name];
          }}
        />
        {ordered.map((mover) => {
          const up = mover.thisMonth - mover.lastMonth > RISE;
          const color = up ? SERIES.blue : MUTED_MARK;
          return (
            <Line
              key={mover.name}
              dataKey={mover.name}
              stroke={color}
              strokeWidth={up ? 2.5 : 1.5}
              strokeOpacity={up ? 1 : 0.55}
              dot={{ r: up ? 3.5 : 3, fill: color, stroke: "#fff", strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              label={({ index, x, y, value }: { index?: number; x?: unknown; y?: unknown; value?: unknown }) =>
                index === 1 ? (
                  <text key={mover.name} x={Number(x) + 9} y={Number(y) + 4} fontSize={11} fontWeight={up ? 600 : 400} fill={up ? INK.primary : INK.muted}>
                    {mover.name} {String(value)}
                  </text>
                ) : <g key={`${mover.name}-${index}`} />
              }
            />
          );
        })}
      </LineChart>
    </ChartArea>
  );
}

/** #3 User App: each category's searches split into Student, Staff and Visitor shares. */
export function AudienceMix({ data }: { data: DecisionAnalytics }) {
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        {accountTypes.map((type) => <span key={type.key}><i style={{ background: type.color }} /> {type.label}</span>)}
      </div>
      <ChartArea height={170}>
        <BarChart data={data.audience} layout="vertical" margin={{ top: 2, right: 4, bottom: 0, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, 100]} />
          <YAxis type="category" dataKey="category" tick={<RowLabelTick />} tickLine={false} axisLine={false} width={58} interval={0} />
          <Tooltip cursor={false} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${value}%`, name]} />
          {accountTypes.map((type) => (
            <Bar key={type.key} dataKey={type.key} name={type.label} stackId="mix" fill={type.color} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
          ))}
        </BarChart>
      </ChartArea>
    </>
  );
}
