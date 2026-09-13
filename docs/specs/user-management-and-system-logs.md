# Specification: Read-Only App User Directory & System Audit Logs

## Problem Statement

Administrators of the KUMPAS campus management platform need visibility into student and visitor adoption of the companion User App and an authoritative audit record of changes made across the campus navigation network.

Currently, the admin portal displays disconnected mock user management controls that include non-functional actions for creating accounts, editing roles, resetting passwords, and deleting users. These actions are dangerous, out of scope, and violate the system boundary because end-user credentials belong to the public User App, not the administrative portal. Furthermore, the System Logs view relies on in-memory mock data, leaving administrators without an audit trail of actual campus data modifications, route network edits, or authentication events.

## Solution

Transform the User Management module into a read-only **User Directory** dedicated to observing companion **App Users** through their registration records and registration-date filtering. The current source schema does not provide an authoritative last-sign-in field, so sign-in activity is explicitly deferred rather than represented with invented or placeholder data. Connect both the User Directory and **System Logs** to live backend endpoints in the Flask API backed by persistent database storage, ensuring full frontend-to-backend readiness with zero broken mock actions.

---

## User Stories

1. As a campus administrator, I want to view a list of registered App Users in the admin portal, so that I can monitor student and visitor adoption of the KUMPAS mobile navigation app.
2. As a campus administrator, I want to see the username of each App User, so that I can identify individual accounts in the directory.
3. As a campus administrator, I want to see the registration date (`createdAt`) of each App User, so that I know when they joined the platform.
4. As a campus administrator, I want to filter the App User directory by registration date range (All time, Last 7 days, Last 30 days, Last 90 days), so that I can analyze registration trends over specific periods.
5. As a campus administrator, I want to search App Users by username, so that I can quickly inspect a specific user's registration record.
6. As a campus administrator, I want paginated navigation across the User Directory, so that large numbers of user accounts load smoothly and predictably.
7. As a campus administrator, I want the User Directory to be clean and read-only without clutter from non-functional Add, Edit, Reset Password, or Delete buttons, so that I do not accidentally attempt invalid administrative actions.
8. As a campus administrator, I want to view a centralized System Logs table, so that I have a unified audit trail of activities occurring across the platform.
9. As a campus administrator, I want each log entry to show the actor, action, target entity, detail, timestamp, and audit category, so that I have complete context on every recorded event.
10. As a campus administrator, I want to filter System Logs by category tabs (`All Logs`, `Admin Activity`, `User Activity`), so that I can focus on administrative configuration changes or end-user search patterns.
11. As a campus administrator, I want to filter System Logs by specific actor usernames, so that I can audit actions performed by a particular staff member or user.
12. As a campus administrator, I want to filter System Logs by date intervals (All Dates, Today, Last 7 days, Last 30 days), so that I can review recent incidents or changes during specific maintenance windows.
13. As a campus administrator, I want to search System Logs by keyword across action names, actor usernames, and target locations, so that I can quickly pinpoint relevant audit entries.
14. As a campus administrator, I want clicking an audit entry to open a detail view with full contextual information, so that I can inspect verbose details when an action requires deeper review.
15. As a developer, I want the frontend API service to seamlessly switch between local mock fixtures and live Flask backend endpoints based on environment configuration (`USE_HTTP_API`), so that development, testing, and production environments remain fully compatible.
16. As a system operator, I want all administrative mutations (creating locations, moving route nodes, updating pathways, and publishing map drafts) to automatically record an audit log entry within the same database transaction, so that the audit history remains perfectly consistent with system state.

---

## Implementation Decisions

### 1. User Directory Architecture & UI Streamlining
- **Read-Only Scope**: Remove the "Add User", "Edit User", "Reset Password", and "Remove User" modal dialogs, triggers, and state handlers from the user interface.
- **Table Columns**: The User Directory table presents two primary columns:
  - **Username**
  - **Registered On (`createdAt`)**
- **Filters**:
  - Username search input field (`q`).
  - Registration date filter dropdown (`created_range`): `All time`, `Last 7 days`, `Last 30 days`, `Last 90 days`.
- **Empty State**: Friendly feedback when queries or date ranges yield zero matches.
- **Ordering**: Results are ordered by registration timestamp descending, with records without registration details last and a deterministic tie-breaker.
- **Deferred capability**: Last-sign-in display and filtering remain out of scope until the companion User App exposes an authoritative timestamp in an agreed source schema.

### 2. System Logs Module Enhancements
- **Centralized Audit Schema**: Align frontend presentation with a unified audit record supporting `id`, `actor`, `action`, `target`, `targetId`, `detail`, `createdAt`, and `category` (`Admin`, `User`, `System`).
- **Date Filtering Realignment**: Replace static date strings with normalized date range presets (`all`, `today`, `7d`, `30d`, `90d`) compatible with backend SQL timestamp intervals.

### 3. Backend Database Models & Schemas
- **App User Entity**:
  A read-only projection (`AppUser`) over the existing companion User App tables, not a new `app_user` table:
  - `public.user.id`: BigInt primary key.
  - `public.user.username`: string identifier.
  - `public.user.info_id`: nullable foreign key to `public.userInfo.id`.
  - `public.userInfo.email`: optional contact field retained by the model but not displayed by this directory.
  - `public.userInfo.created_at`: nullable timezone-aware UTC registration timestamp.
  - The current source schema has no authoritative `last_sign_in_at` or `is_active` field for this directory; those fields must not be synthesized.
- **Audit Log Entity**:
  A centralized `AuditLog` table:
  - `id`: Integer or UUID primary key.
  - `created_at`: DateTime (timezone-aware UTC, indexed).
  - `category`: Enum or String (`Admin`, `User`, `System`).
  - `actor`: String (username or system identifier).
  - `action`: String (e.g., `Created Location`, `Published Map Draft`).
  - `target`: String (display name of the target entity).
  - `target_id`: String (nullable foreign ID or canonical code).
  - `detail`: Text (nullable descriptive summary).

### 4. API Endpoint Contracts
- **App Users Endpoint**:
  - `GET /api/users`
  - **Query Parameters**:
    - `q` (optional string): filter by username match.
    - `created_range` (optional string): `all` | `7d` | `30d` | `90d`.
    - `page` (integer, default 1).
    - `pageSize` (integer, default 20).
  - **Response Payload**:
    ```json
    {
      "items": [
        {
          "id": "usr-1",
          "username": "student01",
          "createdAt": "2026-08-10T09:15:00Z"
        }
      ],
      "total": 1,
      "page": 1,
      "pageSize": 20
    }
    ```
- **System Logs Endpoint**:
  - `GET /api/logs`
  - **Query Parameters**:
    - `category` (optional string): `All` | `Admin` | `User` | `System`.
    - `q` (optional string): search action, actor, target, or detail.
    - `actor` (optional string): filter by actor username.
    - `date_range` (optional string): `all` | `today` | `7d` | `30d` | `90d`.
    - `page` (integer, default 1).
    - `pageSize` (integer, default 20).
  - **Response Payload**:
    ```json
    {
      "items": [
        {
          "id": "log-1",
          "actor": "admin01",
          "action": "Updated Location",
          "target": "Administration Building",
          "targetId": "osm-location-c5fb7a267a8ca63d",
          "detail": "Updated coordinates and function description",
          "createdAt": "2026-08-17T14:05:00Z",
          "category": "Admin"
        }
      ],
      "total": 1,
      "page": 1,
      "pageSize": 20
    }
    ```

### 5. Automatic Audit Logging Integration
- Create an internal audit logging utility function in the backend: `log_audit(category, actor, action, target, target_id=None, detail=None)`.
- Connect calls into mutation endpoints:
  - Location CRUD (`location.py`).
  - Route Node operations (`route_node.py`).
  - Pathway management (`actions.py`).
  - Map draft publish/save operations (`map.py`).
  - Authentication events (`auth.py`).

---

## Testing Decisions

### What Makes a Good Test
- Tests should assert external contracts, HTTP status codes, and rendered UI outputs rather than private internal implementation details.
- Frontend tests verify that user search and registration-range selections trigger expected queries and render correct tabular data without unhandled exceptions.
- Backend tests verify that filtering query parameters (`created_range`, `category`, `actor`) produce properly scoped query sets, deterministic ordering, correct pagination counts, and transactionally commit audit entries. User-directory tests must exercise the real `user`/`userInfo` join or a database-backed stand-in; a plain list mock is insufficient to verify the schema mapping.

### Modules Tested
1. **Frontend**:
   - `frontend/admin/src/features/users/Users.test.tsx` (Component rendering, registration filter changes, absence of mutation controls).
   - `frontend/admin/src/features/logs/Logs.test.tsx` (Tab changes, filter inputs, detail dialog).
   - `frontend/admin/src/services/api.test.ts` (API client serialization of query parameters for `/api/users` and `/api/logs`).
2. **Backend**:
   - `app/routes/test_users.py` (Listing, query search, registration date intervals, deterministic ordering, pagination, and null registration details).
   - `app/routes/test_logs.py` (Filtering by category, date range, actor, and verification of automatic audit logging on mutations).

### Prior Art
- Existing test suites in `app/routes/test_location.py`, `app/routes/test_actions.py`, and `frontend/admin/src/services/api.test.ts`.

---

## Out of Scope

- User creation, password assignment, password resets, or account deletion within the Admin App.
- Role-based privilege editing or hardware device binding in the Admin App.
- Direct editing of audit log records (audit logs are strictly immutable append-only).
- Mobile authentication token issuance for the companion User App.
- Last-sign-in activity display or filtering until an authoritative source field is available.

---

## Further Notes

- References:
  - Domain glossary: [CONTEXT.md](file:///home/jade/dev/projects/isu-camp/CONTEXT.md)
  - Architectural decision record: [docs/adr/0004-read-only-app-user-directory.md](file:///home/jade/dev/projects/isu-camp/docs/adr/0004-read-only-app-user-directory.md)
