import { useCallback, useEffect, useRef, useState } from "react";

const deadlineAfter = (from: number, seconds: number) => (seconds > 0 ? from + seconds * 1000 : 0);

/**
 * A whole-second countdown that starts at `initialSeconds`: `start(n)` restarts it, `seconds` is 0 once it is over.
 * It counts against a deadline, so a tab that was asleep wakes with the time that really passed, and `start` always
 * sets a fresh deadline, even for the number already shown.
 * `onEnd` runs from the tick that finds the deadline passed, ahead of the render, and never when `start(0)` cuts a
 * countdown short.
 */
export function useCountdown(initialSeconds = 0, onEnd?: () => void) {
  const [now, setNow] = useState(() => Date.now());
  const [deadline, setDeadline] = useState(() => deadlineAfter(now, initialSeconds));
  // Counts the ticks, so one that reads an unchanged clock still rearms the timer.
  const [ticks, setTicks] = useState(0);
  const ended = useRef(onEnd);
  useEffect(() => {
    ended.current = onEnd;
  });
  useEffect(() => {
    if (deadline <= now) return;
    // Wake on the next whole second of the deadline, so the shown number changes on time.
    const timer = setTimeout(() => {
      const current = Date.now();
      if (current >= deadline) ended.current?.();
      setNow(current);
      setTicks((n) => n + 1);
    }, (deadline - now) % 1000 || 1000);
    return () => clearTimeout(timer);
  }, [deadline, now, ticks]);
  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setDeadline(deadlineAfter(current, seconds));
  }, []);
  return { seconds: deadline > now ? Math.ceil((deadline - now) / 1000) : 0, start };
}

/** "09:42": minutes and seconds, zero-padded; minutes may pass 99. */
export const formatClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
