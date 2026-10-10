import { useEffect, useState } from "react";

/** A whole-second countdown that starts at `initialSeconds`: `start(n)` restarts it, `seconds` is 0 once it is over. */
export function useCountdown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((remaining) => remaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: setSeconds };
}
