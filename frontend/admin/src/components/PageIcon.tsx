import type { ReactNode } from "react";

export type PageIconName = "map" | "locations" | "users" | "logs";

// One stroke family (24px grid, 1.8 stroke, round caps) so every module header reads as a set.
const glyphs: Record<PageIconName, ReactNode> = {
  map: (
    <>
      <path d="M9 4 3.5 6.2v13.6L9 17.6l6 2.4 5.5-2.2V4.2L15 6.4 9 4Z" />
      <path d="M9 4v13.6M15 6.4V20" />
    </>
  ),
  locations: (
    <>
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
      <path d="M3 21h18M9 7.5h1.5M13.5 7.5H15M9 11.5h1.5M13.5 11.5H15M10 21v-4.5h4V21" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </>
  ),
  logs: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5M12 7.5V12l3 2" />
    </>
  ),
};

/** Module header icon: a mint tile holding a green line glyph. */
export function PageIcon({ name, size = "md" }: { name: PageIconName; size?: "sm" | "md" }) {
  return (
    <span className={`page-icon page-icon-${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {glyphs[name]}
      </svg>
    </span>
  );
}
