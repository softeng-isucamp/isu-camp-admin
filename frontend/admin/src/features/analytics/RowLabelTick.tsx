import { INK } from "../dashboard/analytics/palette";

type Props = { x?: number | string; y?: number | string; payload?: { value?: unknown }; width?: number | string; anchor?: "end" | "middle" };

/**
 * Category-axis label that never wraps (Recharts wraps long ticks into the next row).
 * `anchor="middle"` centres the label in the axis width, for a mirrored chart whose names sit between two bar sets.
 */
export function RowLabelTick({ x = 0, y = 0, payload, width = 0, anchor = "end" }: Props) {
  const middle = anchor === "middle";
  return (
    <text x={middle ? Number(x) - Number(width) / 2 : Number(x) - 6} y={Number(y)} dy={4} textAnchor={middle ? "middle" : "end"} fontSize={12} fill={INK.primary}>
      {String(payload?.value ?? "")}
    </text>
  );
}
