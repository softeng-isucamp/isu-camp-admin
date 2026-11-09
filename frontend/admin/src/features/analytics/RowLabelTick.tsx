import type { KeyboardEvent } from "react";
import { INK } from "../dashboard/analytics/palette";

/** What a row's label opens, indexed like the chart's rows. */
export type RowLink = { label: string; open: () => void } | undefined;

type Props = {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
  index?: number;
  width?: number | string;
  anchor?: "end" | "middle";
  links?: RowLink[];
};

/**
 * Category-axis label that never wraps (Recharts wraps long ticks into the next row).
 * `anchor="middle"` centres the label in the axis width, for a mirrored chart whose names sit between two bar sets.
 * With `links`, a row's label is a focusable link to the same place its bar opens, so the chart works by keyboard
 * and a zero-width bar (which renders nothing to click) still has a target.
 */
export function RowLabelTick({ x = 0, y = 0, payload, index, width = 0, anchor = "end", links }: Props) {
  const middle = anchor === "middle";
  const link = links?.[Number(index)];
  const label = (
    <text
      x={middle ? Number(x) - Number(width) / 2 : Number(x) - 6}
      y={Number(y)}
      dy={4}
      textAnchor={middle ? "middle" : "end"}
      fontSize={12}
      fill={INK.primary}
      textDecoration={link ? "underline" : undefined}
    >
      {String(payload?.value ?? "")}
    </text>
  );
  if (!link) return label;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    link.open();
  };
  return (
    <g className="chart-row-link" role="link" tabIndex={0} aria-label={link.label} onClick={link.open} onKeyDown={onKeyDown} style={{ cursor: "pointer" }}>
      {label}
    </g>
  );
}
