# Profile, backup and recovery frontend contract

This is a proposed contract implemented by the frontend, for the backend team to implement. This change does not add backend routes, roles, database migrations, storage, backup execution, or restore execution.

## Profile and session

Both the sidebar account area (expanded or collapsed) and upper-right avatar navigate to `/profile`. Sign out lives on My Profile, behind a confirmation dialog. All signed-in administrators can edit their own username, email and password. Backup/recovery appears only when both the session and loaded profile explicitly report `superadmin`; missing or unknown roles grant no backup access.

Extend the existing `/api/login` and `/api/me` response's `admin` object with `email` and `role`, preserving its current envelope. Role values are exactly `admin` and `superadmin`. IDs can be strings or numbers and are normalized to strings. The server must derive identity and permissions from the authenticated session, enforce authorization on every endpoint, and never accept an account ID or role change from these forms.

`GET /api/profile` returns the signed-in account directly:

```json
{"id":"1","username":"admin_justine","email":"justine@example.com","role":"superadmin"}
```

`PATCH /api/profile` receives:

```json
{"username":"justine","email":"justine@example.com"}
```

Return the complete updated profile in the same shape. The frontend updates its displayed session immediately; the backend must also update its session identity so reloads show the new username. Validate username/email, enforce uniqueness, and return useful errors (for example 409 for a duplicate). Role is read-only.

`POST /api/profile/password` receives:

```json
{"currentPassword":"current value","newPassword":"new value"}
```

Verify the current password, enforce a minimum of eight characters and the server's password policy, and store a password hash. Return 204 or a JSON success response. This contract assumes the current session remains usable after a password change; if the backend requires logout, coordinate that response and frontend flow before integration. Passwords are never returned. Client confirmation of the new password is local and is not submitted.

These own-account endpoints deliberately do not reuse the existing `/api/admins/:id` management endpoint, whose current semantics are editing other administrators without a current-password check.

## Server-managed backups

All requests include the existing session cookie (`credentials: include`) and JSON request bodies. The browser never receives database credentials or backup storage paths. Backend work runs asynchronously; accepting an operation is not completion.

`GET /api/backups` returns newest-first history and the currently active operation, if any:

```json
{
  "items":[{
    "id":"backup-1",
    "createdAt":"2026-10-09T02:00:00Z",
    "createdBy":"justine",
    "sizeBytes":204800,
    "scope":"Campus data and location photos",
    "status":"ready"
  }],
  "activeJob":null
}
```

`status` is `ready` or `failed`. `scope` is the server's human-readable description of the data included; the frontend does not choose tables or assume whole-system scope. `activeJob` is null or the job shape below, allowing the page to resume status checks after navigation or reload. The backend should expose an active restore even if the restore requires maintenance mode.

`POST /api/backups` receives `{}` and returns 202 with a job:

```json
{"id":"job-1","kind":"backup","status":"queued"}
```

`POST /api/backups/:id/restore` receives:

```json
{"currentPassword":"current value"}
```

Recheck superadmin authorization and the password in this request. Return 202 with a job whose `kind` is `restore`. The frontend also requires typing `RESTORE` and explains that later changes may be lost. Only ready backups can be selected. The backend determines data scope and restore mechanics.

`GET /api/jobs/:id` returns:

```json
{"id":"job-1","kind":"backup","status":"running","message":"Optional human-readable status"}
```

Allowed statuses: `queued`, `running`, `succeeded`, `failed`. `message` is optional; use it to explain failures without exposing secrets. Mark a restore succeeded only after data restoration and verification are complete. Jobs must survive worker restarts as appropriate to the backend design. Authorize access to job status too.

The frontend polls at intervals, stops on terminal states or when unmounted, and disables competing actions while an operation is active. If status checking fails, it says the operation may still be running and offers a status retry instead of resubmitting. The backend must independently prevent conflicting backup/restore operations, return 409 for conflicts, and coordinate maintenance with any other application writing shared data. On completion, the frontend refreshes backup history.

Use errors such as 401 (sign-in required), 403 (role/password denied), 404 (backup/job unavailable), 409 (conflict), 503 (feature unavailable) with a JSON envelope:

```json
{"message":"A backup or restore is already running."}
```

## Fixture demonstration and verification

Run `./dev.sh --fixture` from the repository root. The fixture account `admin_justine` / `password123` is a demo superadmin; `admin_dean` is a second superadmin and `admin_registrar` a plain administrator, both with the same password. Backup creation demonstrates queued/running/succeeded states and adds illustrative history. Restore validates the fixture password and simulates a job; it never restores any map, database, or server data. The page explicitly labels this behavior. Demo histories/jobs and changed passwords last only in the running page's adapter; reload resets them. Username/email are saved to session storage; clear the session storage to reset the identity. No password is written to storage.

Real mode never falls back to fixture behavior. Until the new endpoints and session role exist, profile/backup controls report unavailability or stay hidden. The fixture cannot establish backend authorization or database recovery correctness.

Frontend checks: `npm test` and `npm run build` in `frontend/admin`. These are development verification commands, not production release assets.
