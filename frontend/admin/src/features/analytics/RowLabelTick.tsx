import type { KeyboardEvent, ReactNode } from "react";
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

/** Rough width of one 12px label character, used only where text cannot be measured (jsdom). */
const CHAR_WIDTH = 6.2;
/** Room kept between a label and the axis line. */
const LABEL_GAP = 8;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Rendered width of a 12px label in the page font; falls back to the per-character estimate without a canvas. */
export const measureLabel = (text: string) => {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement("canvas").getContext("2d");
    } catch {
      measureContext = null;
    }
    if (measureContext) {
      const family = getComputedStyle(document.body).fontFamily || "sans-serif";
      // Bold: a focused row label renders at weight 700, so fit the wider of the two weights.
      measureContext.font = `700 12px ${family}`;
    }
  }
  return measureContext ? measureContext.measureText(text).width : text.length * CHAR_WIDTH;
};

/**
 * The name cut with an ellipsis so its rendered width (ellipsis included) fits `width` pixels less the label gap;
 * untouched when it already fits or the width is unknown.
 */
export const fitLabel = (text: string, width: number, measure: (value: string) => number = measureLabel) => {
  const room = width - LABEL_GAP;
  if (!(width > 0) || measure(text) <= room) return text;
  // Longest prefix whose text plus ellipsis fits; 0 leaves just the ellipsis when not even one character does.
  let low = 0;
  let high = text.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`) <= room) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
};

/**
 * Category-axis label that never wraps (Recharts wraps long ticks into the next row).
 * A name wider than its axis is cut with an ellipsis and keeps its full text as a hover title, rather than running off the panel's left edge.
 * `anchor="middle"` centres the label in the axis width, for a mirrored chart whose names sit between two bar sets.
 * With `links`, a row's label is a focusable link to the same place its bar opens, so the chart works by keyboard
 * and a zero-width bar (which renders nothing to click) still has a target.
 */
export function RowLabelTick({ x = 0, y = 0, payload, index, width = 0, anchor = "end", links }: Props) {
  const middle = anchor === "middle";
  const link = links?.[Number(index)];
  const full = String(payload?.value ?? "");
  const text = middle ? full : fitLabel(full, Number(width));
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
      {text !== full && <title>{full}</title>}
      {text}
    </text>
  );
  return <LinkedTick link={link}>{label}</LinkedTick>;
}

/** Wraps a chart tick in a focusable link (Enter or Space opens it); without a link the tick is left as it is. */
export function LinkedTick({ link, children }: { link: RowLink; children: ReactNode }) {
  if (!link) return <>{children}</>;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    link.open();
  };
  return (
    <g className="chart-row-link" role="link" tabIndex={0} aria-label={link.label} onClick={link.open} onKeyDown={onKeyDown} style={{ cursor: "pointer" }}>
      {children}
    </g>
  );
}
