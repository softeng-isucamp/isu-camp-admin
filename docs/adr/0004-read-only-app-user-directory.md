# Read-only App User Directory and Centralized Audit Logging

## Context

The KUMPAS admin portal previously presented mock administrative dialogs for creating, editing, resetting passwords, and removing users. However, in KUMPAS's architecture, administrative credentials belong to the Admin App, whereas user accounts represent mobile/visitor end users of the companion User App. Managing mobile user passwords and accounts from the campus map administration portal is out of boundary, introduces credential custody concerns, and duplicates user management responsibilities.

## Decision

1. **User Directory is Read-Only Observability**:
   - The Users view in `isu-camp-admin` is strictly a read-only directory of **App Users** registered through the companion User App.
   - All mutation actions (Add User, Edit Role, Reset Password, Delete User) are removed from the frontend UI and backend API.
   - The directory displays `username` and `createdAt` (registration date), with username search and registration date-range filters (e.g., last 7 days, 30 days, 90 days, all time).
   - Last-sign-in display and filtering are deferred until the companion User App exposes an authoritative timestamp in the source schema; the Admin App must not synthesize that value.

2. **Centralized Audit Logging**:
   - System and audit logs are recorded centrally via an `audit_log` store to capture `Admin` mutations (locations, pathways, map drafts), `User` actions (search queries, route lookups reported from the User App), and `System` events (authentication attempts).
   - The System Logs interface provides filtering across categories, actors, and date ranges.

## Consequences

- The Admin portal code is significantly streamlined: no password hashing or credential reset flows need to be implemented for App Users inside this repository.
- Administrative authentication (`Admin` session login) remains strictly separated from public client accounts.
- Administrators gain clear visibility into student/visitor adoption and campus platform usage without administrative liability for external user credentials.
