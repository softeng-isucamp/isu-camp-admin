/**
 * Where a signed-out visitor is sent back to after signing in. The guard hands
 * over the page it turned away from (`state.from`), and only a page the admin
 * portal itself serves is ever returned to: never an external address, the
 * sign-in or recovery pages, or an unknown path.
 */

/** The shell's own pages plus My Profile. Mirrors the routes in App.tsx; the test checks the sidebar links are all here. */
export const ADMIN_PAGES = ["/dashboard", "/analytics", "/map-editor", "/locations", "/users", "/profile", "/system-logs"] as const;

/** The page a sign-in lands on when there is no page to return to. */
export const SIGNED_IN_HOME = "/dashboard";

/** A router location, reduced to the parts a return needs. */
export interface ReturnPoint {
  pathname: string;
  search: string;
  hash: string;
}

export const returnPointOf = (location: ReturnPoint): ReturnPoint => ({
  pathname: location.pathname,
  search: location.search,
  hash: location.hash,
});

/** The same-app address to open after signing in: the requested page with its query and hash, else the Dashboard. */
export function landingAfterSignIn(state: unknown): string {
  const from = (state as { from?: Partial<ReturnPoint> } | null)?.from;
  if (!from || typeof from.pathname !== "string" || !(ADMIN_PAGES as readonly string[]).includes(from.pathname)) {
    return SIGNED_IN_HOME;
  }
  const search = typeof from.search === "string" && /^\?\S*$/.test(from.search) ? from.search : "";
  const hash = typeof from.hash === "string" && /^#\S*$/.test(from.hash) ? from.hash : "";
  return `${from.pathname}${search}${hash}`;
}
