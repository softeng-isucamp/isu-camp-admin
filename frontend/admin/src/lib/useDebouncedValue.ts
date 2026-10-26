import { useEffect, useState } from "react";

/** How long typing must pause before a search box asks the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The value once it has stopped changing for `delayMs`. The first render
 * returns the initial value at once, so a deep link such as `?q=` searches
 * without waiting.
 */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
