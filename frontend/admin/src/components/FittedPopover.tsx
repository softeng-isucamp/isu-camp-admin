import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { cx } from "../lib/format";

/** Space kept between a popover and the edge it would otherwise run past. */
const EDGE_MARGIN = 8;

export interface PopoverPlacement {
  /** Align the popover's right edge with its anchor instead of its left edge. */
  alignEnd: boolean;
  /** Open above the anchor instead of below it. */
  openUp: boolean;
}

/**
 * Where a popover that was laid out in its default place (below its anchor,
 * left edges aligned) should go so it stays on screen. Horizontally it also
 * stays inside its card, so a filter at the end of a filter bar opens leftward
 * under its field rather than hanging past the card. It flips up when it
 * runs past the bottom of the viewport, or, for a row's menu in a table, past
 * the bottom of the table's card (where it would cover the pagination), and
 * there is room above. A filter's list is taller than its filter bar, so it
 * only answers to the viewport.
 */
export function fitPlacement(popover: HTMLElement): PopoverPlacement {
  const rect = popover.getBoundingClientRect();
  const anchor = (popover.offsetParent ?? popover.parentElement)?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const card = popover.parentElement?.closest(".card")?.getBoundingClientRect();
  const tableCard = popover.closest("table")?.closest(".card")?.getBoundingClientRect();
  const rightLimit = Math.min(viewportWidth - EDGE_MARGIN, card ? card.right : Infinity);
  const bottomLimit = Math.min(viewportHeight - EDGE_MARGIN, tableCard ? tableCard.bottom : Infinity);

  // Right-aligned, the popover spans leftward from the anchor's right edge; only take that if it fits better.
  const alignEnd = rect.right > rightLimit && (!anchor || anchor.right - rect.width >= EDGE_MARGIN);
  const openUp = rect.bottom > bottomLimit
    && !!anchor && anchor.top - (rect.top - anchor.bottom) - rect.height >= EDGE_MARGIN;
  return { alignEnd, openUp };
}

/**
 * An absolutely positioned popover (a filter's option list or a row's action
 * menu) that measures itself when it opens and flips to the side that keeps it
 * on screen. The `aligns-end` and `opens-up` classes carry the flipped position.
 */
export function FittedPopover({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<PopoverPlacement>({ alignEnd: false, openUp: false });

  // Measured once, before the first paint, in the default position: the flip never shows as a jump.
  useLayoutEffect(() => {
    if (ref.current) setPlacement(fitPlacement(ref.current));
  }, []);

  return (
    <div {...props} ref={ref} className={cx(className, placement.alignEnd && "aligns-end", placement.openUp && "opens-up")}>
      {children}
    </div>
  );
}
