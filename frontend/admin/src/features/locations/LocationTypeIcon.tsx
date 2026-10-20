import { backendLocationType, type BackendLocationType } from "../../lib/locationPolicy";
import type { LocationType, PlaceClassification } from "../../types";

/** A Place with no classification (or a classification without an icon of its own). */
const placeIcon = '<path d="M3 21h18M4 18h16M6 18V9M10 18V9M14 18V9M18 18V9M12 3l9 4.5H3L12 3z" />';

const iconContents: Partial<Record<BackendLocationType, string>> = {
  College: '<path d="M22 10 12 5 2 10l10 5 10-5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /><path d="M22 10v6" />',
  "Campus Services": '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4M10 10h4M10 14h4M10 18h4" />',
  Food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />',
  Parking: '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" />',
  Facility: '<path d="M3 21h18M5 21V10h5v11M14 21V4l5 3v14M7 13h1M7 16h1M16 10h1M16 14h1" />',
  Floor: '<polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />',
  Laboratory: '<path d="M10 2v7.5L4.5 19.5A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-2.5L14 9.5V2" /><line x1="8.5" y1="2" x2="15.5" y2="2" /><path d="M7 16h10" />',
  Room: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" /><circle cx="15" cy="12" r="1.5" fill="currentColor" />',
  Office: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />',
  Restroom: '<circle cx="9" cy="4" r="2" /><path d="M6 9h6l-1 9H7L6 9z" /><circle cx="17" cy="4" r="2" /><path d="M15 9h4l1 9h-2l-.5-5-.5 5h-2z" />',
};

export function locationTypeIconContents(type: LocationType, classification?: PlaceClassification): string {
  const key = backendLocationType({ type, classification });
  return (key && iconContents[key]) || (type === "Place" ? placeIcon : '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />');
}

export function LocationTypeIcon({
  type,
  classification,
  size = 18,
  className,
}: {
  type: LocationType;
  classification?: PlaceClassification;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: locationTypeIconContents(type, classification) }}
    />
  );
}
