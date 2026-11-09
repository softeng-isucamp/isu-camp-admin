import type { AnalyticsPlaceRef } from "../../types";

/** Names shown in a tooltip before the rest collapse into "+N more". */
const TIP_NAMES = 3;

/** "1 place" / "3 places". */
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A few names then "+N more", so a long list never turns the tooltip into a paragraph. */
export const nameSummary = (places: AnalyticsPlaceRef[]) => {
  const shown = places.slice(0, TIP_NAMES).map((place) => place.name).join(", ");
  return places.length > TIP_NAMES ? `${shown} +${places.length - TIP_NAMES} more` : shown;
};

/** Tooltip body for clickable bars: the title, a count line, at most a few names, then where a click goes. */
export function ClickTip({ title, value, names, action }: { title: string; value: string; names?: AnalyticsPlaceRef[]; action?: string }) {
  return (
    <div className="decision-tooltip">
      <strong>{title}</strong>
      <span>{value}</span>
      {!!names?.length && <span className="tip-names">{nameSummary(names)}</span>}
      {action && <span className="tip-action">Click: {action}</span>}
    </div>
  );
}
