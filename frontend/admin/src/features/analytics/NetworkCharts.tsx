import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip, plural } from "./ClickTip";
import { Empty } from "../../components/UI";
import { locationsListLink, pathwayLink, useOpenModule } from "./links";
import { RowLabelTick, type RowLink } from "./RowLabelTick";

type ClosureRow = NonNullable<DecisionAnalytics["closures"]>[number] & { cut: number; longer: number };

/**
 * Per pathway: places cut off (red) and places that only get a longer walk (grey). Counts places, not searches: a rarely
 * searched place is cut off just the same, and a pathway with grey only is a detour, not proof that closing it is safe. Each part opens Locations narrowed to
 * those places (a part with no list is not clickable); the pathway's name opens it in the Map Editor.
 */
export function ClosureImpact({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  if (!data.closures) return <Empty>Name exactly one route node "Main Gate" in the Map Editor to measure closures.</Empty>;
  if (!data.closures.length) return <Empty>No single pathway closure changes any walk from the main gate.</Empty>;
  const rows: ClosureRow[] = [...data.closures]
    .map((row) => ({ ...row, cut: row.cutOff.length, longer: row.longerPlaces?.length ?? row.longerTrip }))
    .sort((a, b) => b.cut - a.cut || b.longerTrip - a.longerTrip);
  const openCut = (entry: unknown) => {
    const row = (entry as { payload?: ClosureRow } | undefined)?.payload;
    if (row?.cutOff.length) navigate(locationsListLink(row.cutOff, `Cut off if ${row.pathway} closes`));
  };
  const openLonger = (entry: unknown) => {
    const row = (entry as { payload?: ClosureRow } | undefined)?.payload;
    if (row?.longerPlaces?.length) navigate(locationsListLink(row.longerPlaces, `Longer walk if ${row.pathway} closes`));
  };
  const links: RowLink[] = rows.map((row) => ({ label: `${row.pathway}: open this pathway in the Map Editor`, open: () => navigate(pathwayLink(row.id)) }));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Cut off</span>
        <span><i style={{ background: MUTED_MARK, opacity: 0.5 }} /> Longer walk</span>
      </div>
      <ChartArea height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
          <YAxis type="category" dataKey="pathway" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={184} interval={0} />
          <Tooltip
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as ClosureRow | undefined) : undefined;
              if (!row) return null;
              return (
                <ClickTip
                  title={row.pathway}
                  value={`${plural(row.cut, "place")} cut off · ${plural(row.longer, "longer walk")}`}
                  names={row.cutOff}
                />
              );
            }}
          />
          <Bar dataKey="cut" stackId="impact" fill={ALERT} onClick={openCut} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.id} cursor={row.cutOff.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar dataKey="longer" stackId="impact" fill={MUTED_MARK} fillOpacity={0.45} radius={[0, 4, 4, 0]} onClick={openLonger} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.id} cursor={row.longerPlaces?.length ? "pointer" : "default"} />)}
            <LabelList
              content={({ x, y, width, height, index }) => {
                const row = rows[Number(index)];
                if (!row) return null;
                return (
                  <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2 + 4} fontSize={11} fill={row.cut ? ALERT : INK.muted} fontWeight={row.cut ? 600 : 400}>
                    {row.cut ? `${row.cut} cut off` : "detour only"}
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

type ReachRow = NonNullable<DecisionAnalytics["reach"]>["modes"][number] & { gap: number };

/**
 * Routable places each access type (Walking, Vehicle) reaches (blue) and the unreached remainder up to the total (grey). The grey part opens
 * Locations narrowed to the places it cannot reach, the blue part to the places it can (when the server lists them).
 */
export function TravelModeReach({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  if (!data.reach) return <Empty>Name exactly one route node "Main Gate" in the Map Editor to measure reach.</Empty>;
  const { origin, total, modes } = data.reach;
  const rows: ReachRow[] = modes.map((mode) => ({ ...mode, gap: mode.unreachable.length }));
  const openGap = (row: ReachRow) => navigate(locationsListLink(row.unreachable, `Not reachable by ${row.mode.toLowerCase()}`));
  const openReached = (entry: unknown) => {
    const row = (entry as { payload?: ReachRow } | undefined)?.payload;
    if (row?.reachablePlaces?.length) navigate(locationsListLink(row.reachablePlaces, `Reachable by ${row.mode.toLowerCase()}`));
  };
  const openUnreached = (entry: unknown) => {
    const row = (entry as { payload?: ReachRow } | undefined)?.payload;
    if (row?.unreachable.length) openGap(row);
  };
  const links: RowLink[] = rows.map((row) =>
    row.unreachable.length ? { label: `${row.mode}: list the ${row.unreachable.length} places it can't reach`, open: () => openGap(row) } : undefined);
  const step = total <= 20 ? 4 : 10;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <ChartArea height={200}>
      <BarChart data={rows} layout="vertical" margin={{ top: 22, right: 8, bottom: 4, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" domain={[0, total]} ticks={ticks} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
        <YAxis yAxisId="modes" type="category" dataKey="mode" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={86} interval={0} />
        {/* Right-hand axis carries the "reached/total" labels: a zero-width bar renders no label. */}
        <YAxis
          yAxisId="counts"
          orientation="right"
          type="category"
          dataKey="mode"
          tickLine={false}
          axisLine={false}
          width={48}
          interval={0}
          tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
            const row = rows[Number(index)];
            if (!row) return <g />;
            return <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={11} fill={INK.primary}>{`${row.reachable}/${total}`}</text>;
          }}
        />
        <ReferenceLine yAxisId="modes" x={total} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `all ${total} from ${origin}`, position: "top", fill: INK.secondary, fontSize: 11 }} />
        {/* Two Y axes and no axis 0: without axisId the tooltip snaps to the wrong rows. */}
        <Tooltip
          axisId="modes"
          cursor={{ fill: "#f3f6f4" }}
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as ReachRow | undefined) : undefined;
            if (!row) return null;
            return (
              <ClickTip
                title={row.mode}
                value={`${row.reachable} of ${total} places reachable from ${origin}`}
                names={row.unreachable}
              />
            );
          }}
        />
        <Bar yAxisId="modes" dataKey="reachable" stackId="reach" fill={SERIES.blue} onClick={openReached} isAnimationActive={false}>
          {rows.map((row) => <Cell key={row.mode} cursor={row.reachablePlaces?.length ? "pointer" : "default"} />)}
        </Bar>
        <Bar yAxisId="modes" dataKey="gap" stackId="reach" fill={MUTED_MARK} fillOpacity={0.45} radius={[0, 4, 4, 0]} onClick={openUnreached} isAnimationActive={false}>
          {rows.map((row) => <Cell key={row.mode} cursor={row.unreachable.length ? "pointer" : "default"} />)}
        </Bar>
      </BarChart>
    </ChartArea>
  );
}
