import { useEffect, useState } from "react";
import { Button, Spinner } from "../../components/UI";
import { cx } from "../../lib/format";
import type { MapLoadState } from "./session/mapLoadProgress";
import { useSmoothedProgress } from "./useSmoothedProgress";

/** How long the bar rests at 100% before the overlay fades, and how long the fade takes. */
const HOLD_MS = 400;
const FADE_MS = 300;

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Phase = "loading" | "holding" | "fading" | "done";

/**
 * Keeps the overlay up through the first load, rests once the bar has filled, then fades it
 * out. Mounting with the data already loaded (a return visit) never shows it.
 */
function useOverlayPhase(loaded: boolean, filled: boolean, reduced: boolean): Phase {
  const [phase, setPhase] = useState<Phase>(loaded ? "done" : "loading");
  useEffect(() => {
    if (!loaded) {
      setPhase("loading");
      return undefined;
    }
    if (!filled) return undefined;
    if (reduced) {
      setPhase("done");
      return undefined;
    }
    setPhase((current) => (current === "done" ? "done" : "holding"));
    const fade = window.setTimeout(() => setPhase((current) => (current === "holding" ? "fading" : current)), HOLD_MS);
    const finish = window.setTimeout(() => setPhase((current) => (current === "fading" ? "done" : current)), HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(finish);
    };
  }, [loaded, filled, reduced]);
  return phase;
}

/**
 * A veil over the map canvas while the editor's campus data loads: a progress bar along the
 * top edge and a status chip naming the stage in progress. A failure turns it into an alert
 * with Retry. Basemap tiles do not hold it up; the map stays visible behind the frost.
 */
export function MapLoadingOverlay({ load }: { load: MapLoadState }) {
  const { stages, loaded, error } = load;
  const [reduced] = useState(prefersReducedMotion);
  const shown = useSmoothedProgress({
    target: loaded ? 1 : load.progress,
    stageSize: 1 / Math.max(1, stages.length),
    frozen: Boolean(error),
    reduced,
  });
  const phase = useOverlayPhase(loaded, shown >= 1, reduced);
  if (phase === "done") return null;

  const percent = Math.round(Math.min(1, Math.max(0, shown)) * 100);
  const inFlight = stages.find((stage) => stage.status === "error")
    ?? stages.find((stage) => stage.status === "loading")
    ?? stages.find((stage) => stage.status === "pending");
  // The chip names the stage the bar is passing through, so it never runs ahead of the bar.
  const reached = shown < 1 ? stages[Math.floor(Math.max(0, shown) * stages.length)] : undefined;
  const current = inFlight && reached && stages.indexOf(reached) > stages.indexOf(inFlight) ? inFlight : reached ?? inFlight;
  const fading = phase === "fading";

  return (
    <div
      className={cx(
        "absolute inset-0 z-[1000] bg-white/45 backdrop-blur-[2px] transition-opacity duration-300 ease-out",
        fading && "pointer-events-none opacity-0",
      )}
      aria-busy={!error}
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5 bg-[#005931]/10"
        role="progressbar"
        aria-label="Map data loading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cx("relative h-full overflow-hidden", error ? "bg-red-600" : "bg-[#005931]")}
          style={{ width: `${error ? Math.max(shown * 100, 6) : shown * 100}%` }}
        >
          {!error && percent < 100 && <span className="map-load-sheen absolute inset-y-0 left-0 w-1/3 bg-white/40" />}
        </div>
      </div>

      <div className="absolute left-1/2 top-4 w-[min(21rem,calc(100%-37rem))] -translate-x-1/2">
        {error ? (
          <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-300 bg-red-50/95 px-4 py-3 text-xs text-red-900 shadow-lg">
            <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-600 font-extrabold text-white">!</span>
            <div className="min-w-0 flex-1">
              <strong className="block">Map data failed to load</strong>
              <span className="block truncate" title={error}>{error}</span>
            </div>
            <Button variant="danger" className="shrink-0 !px-4 !py-2" onClick={load.retry}>Retry</Button>
          </div>
        ) : (
          <div className="map-glass-panel flex items-center gap-3 rounded-2xl px-4 py-3 text-xs">
            <Spinner size={14} className="text-[#005931]" />
            <div role="status" aria-live="polite" className="min-w-0 flex-1 truncate font-extrabold text-[#191c1d]">
              {current ? `${current.label}…` : "Map ready"}
              {current === inFlight && current?.detail && <span className="ml-1 font-semibold text-[#3f4941]">· {current.detail}</span>}
            </div>
            <span className="shrink-0 font-extrabold tabular-nums text-[#005931]">{percent}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
