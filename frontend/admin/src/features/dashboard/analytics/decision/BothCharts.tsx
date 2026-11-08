import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceArea, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../../../types";
import { ChartArea } from "../ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES, TOOLTIP_STYLE } from "../palette";
import { RowLabelTick } from "./RowLabelTick";

const FIX_MIN_SEARCHES = 40;
const FIX_MAX_READY = 55;
const isFixFirst = (searches: number, ready: number) => searches >= FIX_MIN_SEARCHES && ready < FIX_MAX_READY;

type Dot = { name: string; searches: number; ready: number; fix: boolean; above: boolean };

function DotShape(props: { cx?: number; cy?: number; payload?: Dot }) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={payload.fix ? 7 : 5} fill={payload.fix ? ALERT : MUTED_MARK} fillOpacity={payload.fix ? 1 : 0.55} stroke="#fff" strokeWidth={2} />
      <text
        x={payload.above ? cx : cx + 10}
        y={payload.above ? cy - 11 : cy + 4}
        textAnchor={payload.above ? "middle" : "start"}
        fontSize={11}
        fontWeight={payload.fix ? 600 : 400}
        fill={payload.fix ? INK.primary : INK.muted}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {payload.name}
      </text>
    </g>
  );
}

const zoneLabel = (value: string, position: "insideTopLeft" | "insideTopRight" | "insideBottomLeft" | "insideBottomRight", fill: string = INK.muted, fontWeight = 500) =>
  ({ value, position, fill, fontSize: 11, fontWeight, offset: 10 }) as const;

/** #1 Both: demand against readiness. The shaded bottom-right zone is where staff should work first. */
export function FixFirstMatrix({ data }: { data: DecisionAnalytics }) {
  const xMax = Math.max(100, Math.ceil(Math.max(...data.fixFirst.map((p) => p.searches)) / 20) * 20 + 20);
  // A label that would run into a dot just to its right moves above its own dot instead.
  const crowded = (p: { searches: number; ready: number }) =>
    data.fixFirst.some((q) => q !== p && Math.abs(q.ready - p.ready) < 8 && q.searches > p.searches && q.searches - p.searches < xMax * 0.12);
  const dots: Dot[] = data.fixFirst.map((p) => ({ ...p, fix: isFixFirst(p.searches, p.ready), above: crowded(p) }));
  return (
    <ChartArea height={360}>
      <ScatterChart margin={{ top: 10, right: 24, bottom: 26, left: 6 }}>
        <CartesianGrid stroke={INK.grid} />
        <XAxis type="number" dataKey="searches" name="Searches" domain={[0, xMax]} tickCount={6} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={{ value: "Searches", position: "insideBottom", offset: -16, fill: INK.secondary, fontSize: 12 }} />
        <YAxis type="number" dataKey="ready" name="Ready" domain={[0, 110]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} width={58} label={{ value: "Ready", angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle" }, fill: INK.secondary, fontSize: 12 }} />
        <ReferenceArea x1={FIX_MIN_SEARCHES} x2={xMax} y1={0} y2={FIX_MAX_READY} fill={ALERT} fillOpacity={0.07} label={zoneLabel("FIX FIRST", "insideBottomRight", ALERT, 700)} />
        <ReferenceArea x1={0} x2={FIX_MIN_SEARCHES} y1={FIX_MAX_READY} y2={110} fill="none" label={zoneLabel("Ready, rarely searched", "insideTopLeft")} />
        <ReferenceArea x1={FIX_MIN_SEARCHES} x2={xMax} y1={FIX_MAX_READY} y2={110} fill="none" label={zoneLabel("Popular and ready", "insideTopRight")} />
        <ReferenceArea x1={0} x2={FIX_MIN_SEARCHES} y1={0} y2={FIX_MAX_READY} fill="none" label={zoneLabel("Low priority", "insideBottomLeft")} />
        <ReferenceLine x={FIX_MIN_SEARCHES} stroke="#b8c4bd" strokeDasharray="4 4" />
        <ReferenceLine y={FIX_MAX_READY} stroke="#b8c4bd" strokeDasharray="4 4" />
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            const dot = active ? (payload?.[0]?.payload as Dot | undefined) : undefined;
            if (!dot) return null;
            return (
              <div className="decision-tooltip">
                <strong>{dot.name}</strong>
                <span>{dot.searches} searches · {dot.ready}% ready</span>
                {dot.fix && <span style={{ color: ALERT }}>Fix first</span>}
              </div>
            );
          }}
        />
        <Scatter data={dots} shape={<DotShape />} isAnimationActive={false} />
      </ScatterChart>
    </ChartArea>
  );
}

/** #2 Both: searches per building, red when no rooms are mapped inside it. */
export function IndoorDemand({ data }: { data: DecisionAnalytics }) {
  const rows = [...data.indoorDemand].sort((a, b) => b.searches - a.searches);
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> No rooms mapped</span>
        <span><i style={{ background: SERIES.blue }} /> Rooms mapped</span>
      </div>
      <ChartArea height={270}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, bottom: 22, left: 0 }} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={{ value: "Searches", position: "insideBottom", offset: -14, fill: INK.secondary, fontSize: 12 }} />
          <YAxis type="category" dataKey="building" tick={<RowLabelTick />} tickLine={false} axisLine={{ stroke: INK.grid }} width={104} interval={0} />
          <Tooltip cursor={{ fill: "#f3f6f4" }} contentStyle={TOOLTIP_STYLE} formatter={(value, _name, item) => [`${value} searches · ${(item.payload as { hasRooms: boolean }).hasRooms ? "rooms mapped" : "no rooms"}`, ""]} separator="" />
          <Bar dataKey="searches" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.building} fill={row.hasRooms ? SERIES.blue : ALERT} />)}
            <LabelList dataKey="searches" position="right" fontSize={11} fill={INK.primary} />
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}

const HOT_SEARCHES = 50;
const HOT_EDITS = 5;
const BUTTERFLY_HEIGHT = 270;
const BUTTERFLY_MARGIN = { top: 4, bottom: 22 };

/** #3 Both: admin edits (left, muted) against searches (right), mirrored around the place names. Red when well searched and barely edited. */
export function EffortVsDemand({ data }: { data: DecisionAnalytics }) {
  const rows = data.effort.map((row) => ({ ...row, hot: row.searches > HOT_SEARCHES && row.edits < HOT_EDITS }));
  const tip = (unit: string) => ({
    cursor: { fill: "#f3f6f4" },
    contentStyle: TOOLTIP_STYLE,
    separator: "",
    formatter: (value: unknown, _name: unknown, item: { payload?: { place: string } }) => [`${String(value)} ${unit}`, item.payload?.place ?? ""],
  });
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Popular, barely edited</span>
        <span><i style={{ background: SERIES.blue }} /> Searches</span>
        <span><i style={{ background: MUTED_MARK, opacity: 0.6 }} /> Admin edits</span>
      </div>
      <div className="butterfly-chart">
        <ChartArea height={BUTTERFLY_HEIGHT}>
          <BarChart data={rows} layout="vertical" margin={{ ...BUTTERFLY_MARGIN, left: 8, right: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={INK.grid} />
            <XAxis type="number" reversed tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} allowDecimals={false} label={{ value: "Admin edits", position: "insideBottom", offset: -14, fill: INK.secondary, fontSize: 12 }} />
            <YAxis type="category" dataKey="place" hide />
            <Tooltip {...tip("admin edits")} />
            <Bar dataKey="edits" fill={MUTED_MARK} fillOpacity={0.6} radius={[4, 0, 0, 4]} minPointSize={2} isAnimationActive={false}>
              <LabelList dataKey="edits" position="left" fontSize={11} fill={INK.primary} />
            </Bar>
          </BarChart>
        </ChartArea>
        <ChartArea height={BUTTERFLY_HEIGHT}>
          <BarChart data={rows} layout="vertical" margin={{ ...BUTTERFLY_MARGIN, left: 0, right: 32 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={INK.grid} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={{ value: "Searches", position: "insideBottom", offset: -14, fill: INK.secondary, fontSize: 12 }} />
            <YAxis type="category" dataKey="place" tick={<RowLabelTick anchor="middle" />} tickLine={false} axisLine={{ stroke: INK.grid }} width={92} interval={0} />
            <Tooltip {...tip("searches")} />
            <Bar dataKey="searches" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((row) => <Cell key={row.place} fill={row.hot ? ALERT : SERIES.blue} />)}
              <LabelList dataKey="searches" position="right" fontSize={11} fill={INK.primary} />
            </Bar>
          </BarChart>
        </ChartArea>
      </div>
    </>
  );
}
