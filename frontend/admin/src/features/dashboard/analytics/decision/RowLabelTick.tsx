import { INK } from "../palette";

/** Category-axis label that never wraps (Recharts wraps long ticks into the next row). */
export function RowLabelTick({ x = 0, y = 0, payload }: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
  return (
    <text x={Number(x) - 4} y={Number(y)} dy={4} textAnchor="end" fontSize={11} fill={INK.primary}>
      {String(payload?.value ?? "")}
    </text>
  );
}
