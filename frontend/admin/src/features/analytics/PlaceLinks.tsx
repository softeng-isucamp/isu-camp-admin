import { useState } from "react";
import { Link } from "react-router-dom";
import type { AnalyticsPlaceRef } from "../../types";

const PREVIEW = 8;

/** A drill-down strip: a heading, then each place as a link into the module that fixes it. */
export function PlaceLinks({ heading, places, href, module, empty }: {
  heading: string;
  places: AnalyticsPlaceRef[];
  href: (place: AnalyticsPlaceRef) => string;
  module: string;
  empty: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? places : places.slice(0, PREVIEW);
  return (
    <div className="place-links">
      <div className="place-links-head">
        <strong>{heading}</strong>
        {places.length > 0 && <span>Opens in {module}</span>}
      </div>
      {places.length === 0 ? (
        <p className="place-links-empty">{empty}</p>
      ) : (
        <div className="place-links-list">
          {shown.map((place) => (
            <Link key={place.id} to={href(place)} title={`Open ${place.name} in ${module}`}>
              {place.name} <span aria-hidden="true">↗</span>
            </Link>
          ))}
          {places.length > PREVIEW && (
            <button type="button" onClick={() => setAll((value) => !value)}>
              {all ? "Show fewer" : `+${places.length - PREVIEW} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
