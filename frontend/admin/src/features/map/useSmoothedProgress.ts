import { useEffect, useRef, useState } from "react";

/** Longest frame gap that still counts as elapsed time, so a background tab does not jump the bar. */
const MAX_FRAME_MS = 100;
/** Time constants of the exponential easing, in milliseconds. */
const CATCH_UP_MS = 450;
const TRICKLE_MS = 2500;
const COMPLETE_MS = 110;
/** How far into the next stage the bar may creep while that stage is in flight. */
const TRICKLE_FRACTION = 0.9;

/**
 * The next displayed progress (0..1) after `dtMs` of animation.
 *
 * `target` is the real fraction of finished stages and `stageSize` the share one stage
 * represents. The value eases up to the target, creeps toward 90% of the way to the next
 * stage while it is in flight (never past that ceiling), and eases to exactly 1 once the
 * target reaches 1. It never moves backwards, except that a target that dropped below
 * what is shown (a reload) resets it.
 */
export function stepProgress(previous: number, target: number, stageSize: number, dtMs: number): number {
  const dt = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  if (target >= 1) {
    const next = previous + (1 - previous) * (1 - Math.exp(-dt / COMPLETE_MS));
    return 1 - next < 0.002 ? 1 : next;
  }
  const ceiling = target + TRICKLE_FRACTION * stageSize;
  if (previous > ceiling) return target;
  const trickle = (ceiling - previous) * (1 - Math.exp(-dt / TRICKLE_MS));
  const catchUp = previous < target ? (target - previous) * (1 - Math.exp(-dt / CATCH_UP_MS)) : 0;
  return Math.min(previous + Math.max(trickle, catchUp), ceiling);
}

interface SmoothedProgressOptions {
  target: number;
  stageSize: number;
  /** Stand still, e.g. after a failure. */
  frozen: boolean;
  /** Follow the target directly instead of animating. */
  reduced: boolean;
}

/** Animates {@link stepProgress} on every frame until the value settles. */
export function useSmoothedProgress({ target, stageSize, frozen, reduced }: SmoothedProgressOptions) {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const previousTarget = useRef(target);

  useEffect(() => {
    if (target < previousTarget.current) {
      shownRef.current = target;
      setShown(target);
    }
    previousTarget.current = target;
    if (reduced || frozen) return undefined;

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = stepProgress(shownRef.current, target, stageSize, now - last);
      last = now;
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }
      // Stop once the creep has settled; a new target restarts the loop.
      const settled = target >= 1 ? next >= 1 : target + TRICKLE_FRACTION * stageSize - next < 1e-4;
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, stageSize, frozen, reduced]);

  return reduced ? target : shown;
}
