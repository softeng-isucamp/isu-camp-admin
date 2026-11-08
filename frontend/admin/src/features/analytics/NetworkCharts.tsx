import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES, TOOLTIP_STYLE } from "../dashboard/analytics/palette";
import { mapLink } from "./links";
import { PlaceLinks } from "./PlaceLinks";
import { RowLabelTick } from "./RowLabelTick";

const axisTitle = (value: string) => ({ value, position: "insideBottom" as const, offset: -14, fill: INK.secondary, fontSize: 12 });
const SELECTED_FILL = "#f1f5f3";

/** Per pathway: places cut off (red) and places that only get a longer walk (grey). Click a bar to list the cut-off places. */
export function ClosureImpact({ data }: { data: DecisionAnalytics }) {
  const rows = [...data.closures]
    .map((row) => ({ ...row, cut: row.cutOff.length }))
    .sort((a, b) => b.cut - a.cut || b.longerTrip - a.longerTrip);
  const [selectedId, setSelectedId] = useState(rows[0]?.id);
  const selected = rows.find((row) => row.id === selectedId);
  const select = (entry: unknown) => {
    const id = (entry as { payload?: { id?: string } } | undefined)?.payload?.id;
    if (id) setSelectedId(id);
  };
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Places cut off</span>
        <span><i style={{ background: MUTED_MARK, opacity: 0.6 }} /> Places with a longer walk</span>
      </div>
      <ChartArea height={250}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 22, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={axisTitle("Places affected if this pathway closes")} />
          <YAxis type="category" dataKey="pathway" tick={<RowLabelTick />} tickLine={false} axisLine={{ stroke: INK.grid }} width={168} interval={0} />
          <Tooltip cursor={{ fill: SELECTED_FILL }} contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [String(value), name === "cut" ? "Cut off" : "Longer walk"]} />
          <Bar dataKey="cut" stackId="impact" fill={ALERT} onClick={select} cursor="pointer" isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.id} fillOpacity={row.id === selectedId ? 1 : 0.75} />)}
          </Bar>
          <Bar dataKey="longerTrip" stackId="impact" fill={MUTED_MARK} fillOpacity={0.45} radius={[0, 4, 4, 0]} onClick={select} cursor="pointer" isAnimationActive={false}>
            <LabelList
              position="right"
              content={({ x, y, width, height, index }) => {
                const row = rows[Number(index)];
                if (!row) return null;
                return (
                  <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2 + 4} fontSize={11} fill={row.cut ? ALERT : INK.muted} fontWeight={row.cut ? 600 : 400}>
                    {row.cut ? `${row.cut} cut off` : "safe"}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ChartArea>
      {selected && (
        <PlaceLinks
          heading={`Cut off if “${selected.pathway}” closes`}
          places={selected.cutOff}
          href={mapLink}
          module="Map Editor"
          empty={`Nobody is cut off; ${selected.longerTrip} places just get a longer walk. Safe to close.`}
        />
      )}
    </>
  );
}

/** Routable places each travel mode reaches from the origin, against the total. Click a bar to list the places it cannot reach. */
export function TravelModeReach({ data }: { data: DecisionAnalytics }) {
  const { origin, total, modes } = data.reach;
  const worst = [...modes].sort((a, b) => a.reachable - b.reachable)[0];
  const [selectedMode, setSelectedMode] = useState(worst?.mode);
  const selected = modes.find((row) => row.mode === selectedMode);
  const step = total <= 20 ? 4 : 10;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: SERIES.blue }} /> Reachable from {origin}</span>
      </div>
      <ChartArea height={250}>
        <BarChart data={modes} layout="vertical" margin={{ top: 20, right: 52, bottom: 22, left: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" domain={[0, total]} ticks={ticks} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} label={axisTitle(`Routable places reached from ${origin}`)} />
          <YAxis type="category" dataKey="mode" tick={<RowLabelTick />} tickLine={false} axisLine={{ stroke: INK.grid }} width={86} interval={0} />
          <ReferenceLine x={total} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `all ${total}`, position: "top", fill: INK.secondary, fontSize: 11 }} />
          <Tooltip cursor={{ fill: SELECTED_FILL }} contentStyle={TOOLTIP_STYLE} separator="" formatter={(value) => [`${value} of ${total} places reachable`, ""]} />
          <Bar
            dataKey="reachable"
            fill={SERIES.blue}
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(entry) => {
              const mode = (entry as { payload?: { mode?: string } } | undefined)?.payload?.mode;
              if (mode) setSelectedMode(mode);
            }}
            isAnimationActive={false}
          >
            {modes.map((row) => <Cell key={row.mode} fillOpacity={row.mode === selectedMode ? 1 : 0.7} />)}
            <LabelList dataKey="reachable" position="right" fontSize={11} fill={INK.primary} formatter={(value) => `${String(value)}/${total}`} />
          </Bar>
        </BarChart>
      </ChartArea>
      {selected && (
        <PlaceLinks
          heading={`Not reachable by ${selected.mode.toLowerCase()} (${selected.unreachable.length})`}
          places={selected.unreachable}
          href={mapLink}
          module="Map Editor"
          empty={`Every routable place is reachable by ${selected.mode.toLowerCase()}.`}
        />
      )}
    </>
  );
}
