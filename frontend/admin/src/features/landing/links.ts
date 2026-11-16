/** Where the landing page sends people. Kept free of React so App.tsx can use it without loading the lazy landing chunk. */

/** Not live yet; this is the one place to change when the web app is deployed. The QR in campusMap.ts encodes it too. */
export const WEB_APP_URL = 'https://app.kumpas.live'
export const WEB_APP_HOST = new URL(WEB_APP_URL).host
export const APK_URL = 'https://github.com/softeng-isucamp/isu-camp-app/releases/latest/download/app-release.apk'

/** The host that holds the admin session cookie and serves the portal. */
export const ADMIN_ORIGIN = 'https://admin.kumpas.live'
export const ADMIN_LOGIN_URL = `${ADMIN_ORIGIN}/login`

/** The landing page's own host, served by the same container as the portal. kumpas.live and www are not touched. */
export const LANDING_HOST = 'home.kumpas.live'

/**
 * True on the landing host. There `/` is the landing and every other path belongs to the portal, which lives on
 * the admin host. Everywhere else (the admin host, localhost, previews) the landing is reachable at `/home`.
 */
export function isLandingHost(hostname: string = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return hostname === LANDING_HOST
}

/** Same path, query and hash on the admin origin. */
export const adminUrlFor = (location: { pathname: string; search: string; hash: string }) => `${ADMIN_ORIGIN}${location.pathname}${location.search}${location.hash}`
