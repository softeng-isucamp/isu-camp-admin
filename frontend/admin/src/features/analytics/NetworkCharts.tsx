import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { AXIS_TICK, ALERT, INK, MUTED_MARK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip } from "./ClickTip";
import { Empty } from "../../components/UI";
import { locationsListLink, pathwayLink } from "./links";
import { RowLabelTick, type RowLink } from "./RowLabelTick";

type ClosureRow = DecisionAnalytics["closures"][number] & { cut: number };

/** Per pathway: places cut off (red) and places that only get a longer walk (grey). A click opens that pathway in the Map Editor. */
export function ClosureImpact({ data }: { data: DecisionAnalytics }) {
  const navigate = useNavigate();
  if (!data.closures.length) return <Empty>No single pathway closure changes any walk from the main gate.</Empty>;
  const rows: ClosureRow[] = [...data.closures]
    .map((row) => ({ ...row, cut: row.cutOff.length }))
    .sort((a, b) => b.cut - a.cut || b.longerTrip - a.longerTrip);
  const open = (entry: unknown) => {
    const row = (entry as { payload?: ClosureRow } | undefined)?.payload;
    if (!row) return;
    navigate(pathwayLink(row.id));
  };
  const links: RowLink[] = rows.map((row) => ({ label: `${row.pathway}: open this pathway in the Map Editor`, open: () => navigate(pathwayLink(row.id)) }));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Cut off</span>
        <span><i style={{ background: MUTED_MARK, opacity: 0.5 }} /> Longer walk</span>
      </div>
      <ChartArea height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
          <YAxis type="category" dataKey="pathway" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={168} interval={0} />
          <Tooltip
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as ClosureRow | undefined) : undefined;
              if (!row) return null;
              return (
                <ClickTip
                  title={row.pathway}
                  value={row.cut ? `Cuts off ${row.cutOff.map((place) => place.name).join(", ")} · ${row.longerTrip} longer walks` : `Nobody cut off · ${row.longerTrip} longer walks`}
                  action="open this pathway in Map Editor"
                />
              );
            }}
          />
          <Bar dataKey="cut" stackId="impact" fill={ALERT} cursor="pointer" onClick={open} isAnimationActive={false} />
          <Bar dataKey="longerTrip" stackId="impact" fill={MUTED_MARK} fillOpacity={0.45} radius={[0, 4, 4, 0]} cursor="pointer" onClick={open} isAnimationActive={false}>
            <LabelList
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
    </>
  );
}

type ReachRow = NonNullable<DecisionAnalytics["reach"]>["modes"][number];

/** Routable places each travel mode reaches, against the total. A click opens Locations filtered to the places it cannot reach. */
export function TravelModeReach({ data }: { data: DecisionAnalytics }) {
  const navigate = useNavigate();
  if (!data.reach) return <Empty>Name exactly one route node "Main Gate" in the Map Editor to measure reach.</Empty>;
  const { origin, total, modes } = data.reach;
  const openRow = (row: ReachRow) => navigate(locationsListLink(row.unreachable, `Not reachable by ${row.mode.toLowerCase()}`));
  const links: RowLink[] = modes.map((row) =>
    row.unreachable.length ? { label: `${row.mode}: list the ${row.unreachable.length} places it can't reach`, open: () => openRow(row) } : undefined);
  const step = total <= 20 ? 4 : 10;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <ChartArea height={266}>
      <BarChart data={modes} layout="vertical" margin={{ top: 22, right: 52, bottom: 4, left: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={INK.grid} />
        <XAxis type="number" domain={[0, total]} ticks={ticks} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: INK.grid }} />
        <YAxis type="category" dataKey="mode" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={86} interval={0} />
        <ReferenceLine x={total} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `all ${total} from ${origin}`, position: "top", fill: INK.secondary, fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: "#f3f6f4" }}
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as ReachRow | undefined) : undefined;
            if (!row) return null;
            return (
              <ClickTip
                title={row.mode}
                value={`${row.reachable} of ${total} places reachable from ${origin}`}
                action={row.unreachable.length ? `list the ${row.unreachable.length} it can't reach` : undefined}
              />
            );
          }}
        />
        <Bar
          dataKey="reachable"
          fill={SERIES.blue}
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={(entry) => {
            const row = (entry as { payload?: ReachRow } | undefined)?.payload;
            if (row?.unreachable.length) openRow(row);
          }}
          isAnimationActive={false}
        >
          <LabelList dataKey="reachable" position="right" fontSize={11} fill={INK.primary} formatter={(value) => `${String(value)}/${total}`} />
        </Bar>
      </BarChart>
    </ChartArea>
  );
}
