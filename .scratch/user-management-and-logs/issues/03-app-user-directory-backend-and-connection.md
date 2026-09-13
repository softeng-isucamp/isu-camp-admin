# 03: App User Directory Backend Contract & Live API Connection

**What to build:** An administrative user can load the User Directory in the admin portal and receive live App User records from the existing `public.user` and `public.userInfo` tables. The backend provides `GET /api/users` with server-side username search, registration-date filtering, deterministic newest-registration-first ordering, and pagination. The frontend service delegates to this live endpoint when HTTP mode is active. Last-sign-in display and filtering are deferred because the current source schema has no authoritative timestamp.

**Blocked by:** 01: Streamline User Directory UI to Read-Only Presentation

**Status:** ready-for-agent

- [ ] Database projection (`AppUser`) maps `public.user.id`, `public.user.username`, and nullable `public.user.info_id` to `public.userInfo.id`, `email`, and `created_at`.
- [ ] Backend route `GET /api/users` is implemented with query parameters: `q`, `created_range` (`all`, `7d`, `30d`, `90d`), `page`, and `pageSize`.
- [ ] Backend route applies date range calculations against UTC timestamps and returns `{ items, total, page, pageSize }` with HTTP 200.
- [ ] Frontend API service (`services.users.list`) connects to `GET /api/users` via HTTP when enabled (`USE_HTTP_API`), correctly serializing filter parameters.
- [ ] Frontend User Directory table reflects live backend counts and supports smooth paginated navigation.
- [ ] Backend test suite asserts the real join, registration date ranges, deterministic ordering, search query matching, and database-backed pagination.
