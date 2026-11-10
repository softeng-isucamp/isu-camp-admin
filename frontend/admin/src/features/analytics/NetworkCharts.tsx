import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip, plural } from "./ClickTip";
import { Empty } from "../../components/UI";
import { locationsListLink, pathwayLink, useOpenModule } from "./links";
import { LinkedTick, RowLabelTick, type RowLink } from "./RowLabelTick";

type ClosureRow = NonNullable<DecisionAnalytics["closures"]>[number] & { cut: number; longer: number };

/**
 * Per pathway: places cut off (red) and places that only get a longer walk (grey). Counts places, not searches: a rarely
 * searched place is cut off just the same, and a pathway with grey only is a detour, not proof that closing it is safe. Each part opens Locations narrowed to
 * those places (a part with no list is not clickable); the pathway's name opens it in the Map Editor. By keyboard, the
 * "N cut off" and "longer walk" labels on the right are links to the same two lists.
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
  const cutLinks: RowLink[] = rows.map((row) =>
    row.cutOff.length ? { label: `${row.pathway}: list the ${plural(row.cutOff.length, "place")} cut off in Locations`, open: () => openCut({ payload: row }) } : undefined);
  const longerLinks: RowLink[] = rows.map((row) =>
    row.longerPlaces?.length ? { label: `${row.pathway}: list the ${plural(row.longerPlaces.length, "place")} with a longer walk in Locations`, open: () => openLonger({ payload: row }) } : undefined);
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Cut off</span>
        <span><i style={{ background: MUTED_MARK, opacity: 0.5 }} /> Longer walk</span>
      </div>
      <ChartArea height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
          <YAxis yAxisId="pathways" type="category" dataKey="pathway" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={184} interval={0} />
          {/* Right-hand axis carries the count labels as links: a zero-width bar renders nothing to focus or click. */}
          <YAxis
            yAxisId="counts"
            orientation="right"
            type="category"
            dataKey="pathway"
            tickLine={false}
            axisLine={false}
            width={104}
            interval={0}
            tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
              const row = rows[Number(index)];
              if (!row) return <g />;
              const at = Number(index);
              const left = Number(x) + 8;
              return (
                <g>
                  {row.cut ? (
                    <LinkedTick link={cutLinks[at]}>
                      <text x={left} y={Number(y)} dy={row.longer ? -2 : 4} fontSize={11} fontWeight={600} fill={ALERT} textDecoration={cutLinks[at] ? "underline" : undefined}>{`${row.cut} cut off`}</text>
                    </LinkedTick>
                  ) : null}
                  {row.longer ? (
                    <LinkedTick link={longerLinks[at]}>
                      <text x={left} y={Number(y)} dy={row.cut ? 12 : 4} fontSize={11} fill={INK.muted} textDecoration={longerLinks[at] ? "underline" : undefined}>{row.cut ? `${row.longer} longer walk` : "detour only"}</text>
                    </LinkedTick>
                  ) : null}
                </g>
              );
            }}
          />
          <Tooltip
            axisId="pathways"
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
          <Bar yAxisId="pathways" dataKey="cut" stackId="impact" fill={ALERT} onClick={openCut} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.id} cursor={row.cutOff.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar yAxisId="pathways" dataKey="longer" stackId="impact" fill={MUTED_MARK} fillOpacity={0.45} radius={[0, 4, 4, 0]} onClick={openLonger} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.id} cursor={row.longerPlaces?.length ? "pointer" : "default"} />)}
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}

type ReachRow = NonNullable<DecisionAnalytics["reach"]>["modes"][number] & { gap: number };

/**
 * Routable places each access type (Walking, Vehicle) reaches (blue) and the unreached remainder up to the total (grey). The grey part opens
 * Locations narrowed to the places it cannot reach, the blue part to the places it can (when the server lists them). By keyboard, the
 * row label lists the places it cannot reach and the "reached/total" label the places it can.
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
  const reachedLinks: RowLink[] = rows.map((row) =>
    row.reachablePlaces?.length ? { label: `${row.mode}: list the ${row.reachablePlaces.length} places it reaches`, open: () => navigate(locationsListLink(row.reachablePlaces!, `Reachable by ${row.mode.toLowerCase()}`)) } : undefined);
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
            return (
              <LinkedTick link={reachedLinks[Number(index)]}>
                <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={11} fill={INK.primary} textDecoration={reachedLinks[Number(index)] ? "underline" : undefined}>{`${row.reachable}/${total}`}</text>
              </LinkedTick>
            );
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
