import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FittedPopover } from "../../components/FittedPopover";
import type { ChartCopy } from "./copy";

type Props = { copy: ChartCopy; wide?: boolean; aside?: ReactNode; children: ReactNode };

/**
 * One graph inside a section panel: title, the chart, and an (i) button that opens the reading guide
 * as a small floating popover. It floats over the page (no layout shift), stays on screen through
 * FittedPopover, and closes on Esc, an outside click, or the button again, returning focus to the button.
 */
export function GraphBlock({ copy, wide = false, aside, children }: Props) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && anchorRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const toggle = () => {
    setOpen((value) => !value);
    if (open) buttonRef.current?.focus();
  };

  return (
    <div className={`graph${wide ? " graph-wide" : ""}`}>
      <div className="graph-head">
        <div className="graph-title">
          <h3>{copy.title}</h3>
        </div>
        <div className="graph-aside">
          {aside}
          <span className="graph-info-anchor" ref={anchorRef}>
            <button
              ref={buttonRef}
              type="button"
              className={`graph-info${open ? " open" : ""}`}
              aria-expanded={open}
              aria-controls={open ? popoverId : undefined}
              aria-haspopup="dialog"
              aria-label={`How to read ${copy.title}`}
              onClick={toggle}
            >
              i
            </button>
            {open && (
              <FittedPopover className="graph-help" id={popoverId} role="dialog" aria-label={`How to read ${copy.title}`}>
                <p>{copy.what}</p>
                <ul>
                  {copy.read.map((row) => (
                    <li key={row.see}>
                      <strong>{row.see}:</strong> {row.means}
                      {row.action && <span className="graph-do"> {row.action}</span>}
                    </li>
                  ))}
                </ul>
                <p className="graph-data">Data: {copy.data}</p>
              </FittedPopover>
            )}
          </span>
        </div>
      </div>
      <div className="graph-plot">{children}</div>
    </div>
  );
}
