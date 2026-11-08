import { Bar, BarChart, Cell, LabelList, ReferenceArea, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../../../types";
import { ChartArea } from "../ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES, TOOLTIP_STYLE } from "../palette";
import { RowLabelTick } from "./RowLabelTick";

const FIX_MIN_SEARCHES = 40;
const FIX_MAX_READY = 55;
const isFixFirst = (searches: number, ready: number) => searches >= FIX_MIN_SEARCHES && ready < FIX_MAX_READY;

type Dot = { name: string; searches: number; ready: number; fix: boolean; xMax: number };

function DotShape(props: { cx?: number; cy?: number; payload?: Dot }) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  const { fix, name, searches, xMax } = payload;
  const ratio = searches / xMax;
  // Right-hand dots label above (their left side is crowded); mid dots label left; the rest label right.
  const above = ratio > 0.85;
  const left = ratio > 0.7;
  const labelX = above ? cx : cx + (left ? -10 : 10);
  const labelY = above ? cy - 11 : cy + 4;
  return (
    <g>
      <circle cx={cx} cy={cy} r={fix ? 6 : 4.5} fill={fix ? ALERT : MUTED_MARK} fillOpacity={fix ? 1 : 0.5} stroke="#fff" strokeWidth={2} />
      {fix && (
        <text x={labelX} y={labelY} textAnchor={above || left ? "end" : "start"} fontSize={11} fontWeight={600} fill={INK.primary} stroke="#fff" strokeWidth={3} paintOrder="stroke">
          {name}
        </text>
      )}
    </g>
  );
}

const quadrantLabel = (value: string, position: "insideTopLeft" | "insideTopRight" | "insideBottomLeft" | "insideBottomRight", fill: string = INK.muted, fontWeight = 400) =>
  ({ value, position, fill, fontSize: 10, fontWeight }) as const;

/** #1 Both: demand against readiness. The shaded bottom-right zone is where staff should work first. */
export function FixFirstMatrix({ data }: { data: DecisionAnalytics }) {
  const xMax = Math.max(100, Math.ceil(Math.max(...data.fixFirst.map((p) => p.searches)) / 10) * 10);
  const dots: Dot[] = data.fixFirst.map((p) => ({ ...p, fix: isFixFirst(p.searches, p.ready), xMax }));
  return (
    <ChartArea height={262}>
      <ScatterChart margin={{ top: 8, right: 14, bottom: 20, left: 8 }}>
        <XAxis type="number" dataKey="searches" name="Searches" domain={[0, xMax]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={{ value: "Searches →", position: "insideBottom", offset: -10, fill: INK.muted, fontSize: 10 }} />
        <YAxis type="number" dataKey="ready" name="Ready" domain={[0, 116]} ticks={[0, 50, 100]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} width={44} label={{ value: "Ready % →", angle: -90, position: "insideLeft", offset: 4, style: { textAnchor: "middle" }, fill: INK.muted, fontSize: 10 }} />
        <ReferenceArea x1={0} x2={FIX_MIN_SEARCHES} y1={FIX_MAX_READY} y2={116} fill="none" label={quadrantLabel("ready, unused", "insideTopLeft")} />
        <ReferenceArea x1={FIX_MIN_SEARCHES} x2={xMax} y1={FIX_MAX_READY} y2={116} fill="none" label={quadrantLabel("keep fresh", "insideTopRight")} />
        <ReferenceArea x1={0} x2={FIX_MIN_SEARCHES} y1={0} y2={FIX_MAX_READY} fill="none" label={quadrantLabel("low priority", "insideBottomLeft")} />
        <ReferenceArea x1={FIX_MIN_SEARCHES} x2={xMax} y1={0} y2={FIX_MAX_READY} fill={ALERT} fillOpacity={0.08} label={quadrantLabel("FIX FIRST", "insideTopRight", ALERT, 700)} />
        <ReferenceLine x={FIX_MIN_SEARCHES} stroke={INK.grid} strokeDasharray="3 3" />
        <ReferenceLine y={FIX_MAX_READY} stroke={INK.grid} strokeDasharray="3 3" />
        <Tooltip
          cursor={false}
          contentStyle={TOOLTIP_STYLE}
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
  const max = Math.max(...rows.map((row) => row.searches));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> no rooms</span>
        <span><i style={{ background: SERIES.blue }} /> has rooms</span>
      </div>
      <ChartArea height={170}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 34, bottom: 0, left: 0 }} barCategoryGap={5}>
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis type="category" dataKey="building" tick={<RowLabelTick />} tickLine={false} axisLine={false} width={92} interval={0} />
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

/** #3 Both: admin edits (left, muted) against searches (right). Red when well searched and barely edited. */
export function EffortVsDemand({ data }: { data: DecisionAnalytics }) {
  const editMax = Math.max(25, ...data.effort.map((row) => row.edits));
  const searchMax = Math.max(100, ...data.effort.map((row) => row.searches));
  return (
    <div className="butterfly">
      <div className="butterfly-head"><span>← admin edits</span><span /><span>searches →</span></div>
      {data.effort.map((row) => {
        const hot = row.searches > 50 && row.edits < 5;
        return (
          <div className="butterfly-row" key={row.place}>
            <div className="butterfly-side left">
              <b>{row.edits}</b>
              <i style={{ width: `${(row.edits / editMax) * 100}%`, background: MUTED_MARK, opacity: 0.55 }} title={`${row.place}: ${row.edits} edits`} />
            </div>
            <span className="butterfly-name">{row.place}</span>
            <div className="butterfly-side right">
              <i style={{ width: `${(row.searches / searchMax) * 100}%`, background: hot ? ALERT : SERIES.blue }} title={`${row.place}: ${row.searches} searches${hot ? " · few admin edits" : ""}`} />
              <b>{row.searches}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
