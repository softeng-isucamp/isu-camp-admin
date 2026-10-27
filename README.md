# ISU-CAMP Admin

This repository contains the ISU-CAMP administration backend scaffold and the admin frontend.

## Repository layout

- `app/` contains the Python backend modules.
- `frontend/admin/` contains the Vite, React, and TypeScript admin portal.
- `static/` is reserved for Flask-managed assets.

## Running Backend & Frontend

### Unified Runner (Recommended)

Choose a runtime from the project root. The default is **real mode**: Flask plus the frontend, backed by the configured database.

**Linux / macOS (Bash):**
```bash
./dev.sh --real
```

**Windows (Command Prompt):**
```cmd
dev.bat --real
```

**Windows (PowerShell):**
```powershell
.\dev.ps1 --real
```

---

### Comparison: Unified Script vs Separate Commands

| Execution Method | Pros | Cons |
| :--- | :--- | :--- |
| **Unified Script (`dev.sh` / `dev.bat`)** *(Recommended)* | • Starts backend & frontend together in one command<br>• Fast and simple day-to-day workflow<br>• Cleans up both processes on `CTRL+C` | • Combined output streams in a single terminal |
| **Separate Commands** | • Separate log windows per service<br>• Restart backend or frontend independently without stopping both | • Requires opening two terminal windows and navigating to subdirectories |

---

### Running Separately

If you prefer isolated logs or independent control:

1. **Flask Backend** (Terminal 1):
   ```bash
   venv/bin/python app/services/database.py
   ```

2. **Admin Frontend** (Terminal 2):
   ```bash
   cd frontend/admin
   npm run dev
   ```

Open the frontend at `http://127.0.0.1:5173`, which is where the runners serve it. Use the same spelling as the backend address, not `localhost`: see [why the frontend and backend hosts must match](#why-the-frontend-and-backend-hosts-must-match). The unified runner fixes port 5173 and fails if it is occupied; stop your own previous server or choose a separately configured origin.

### Fixture versus real backend

| Mode | Linux/macOS | Windows CMD | PowerShell | Data and login |
| --- | --- | --- | --- | --- |
| Real (default) | `./dev.sh --real` | `dev.bat --real` | `.\dev.ps1 --real` | Starts Flask and the frontend. Requires backend/database configuration and a real backend account. |
| Fixture | `./dev.sh --fixture` | `dev.bat --fixture` | `.\dev.ps1 --fixture` | Starts only the frontend with the local adapter and OSM fixture. No Flask or database required. Logins, all with `password123`: `admin_justine` and `admin_dean` (superadmins), `admin_registrar` (administrator with every permission) and `admin_viewer` (administrator with view-only permissions). |

The runners print the selected mode and login guidance. Fixture credentials apply only to fixture mode. Fixture edits stay in the local adapter and do not update the backend database.

Real mode explicitly sets `VITE_TEST_LOCAL_ADAPTER=false`, `VITE_API_MODE=real`, and `VITE_MAP_FIXTURE=none`. Its API address defaults to `http://127.0.0.1:5000`; set `VITE_API_BASE_URL` in the shell before running the script to override it. Fixture mode explicitly sets `VITE_TEST_LOCAL_ADAPTER=true`, `VITE_API_MODE=local`, and `VITE_MAP_FIXTURE=osm`. These process variables override Vite's local `.env` settings. Setting only `VITE_API_MODE=local` does not enable the fixture adapter.

### Why the frontend and backend hosts must match

`localhost` and `127.0.0.1` are the same machine but two different hosts to a browser, and that distinction bites twice.

**CORS**, which is the easy half: `ALLOWED_ORIGINS` in [app/services/database.py](app/services/database.py) allows both spellings on ports 5173 and 5174, so a preflight succeeds either way. Any other host or port is refused, which the console reports as a CORS policy error. Covered by `app/tests/cors.py`.

**The session cookie**, which is the half that looks like something else entirely. Flask does not set `SameSite` on the session cookie, so browsers treat it as `SameSite=Lax` and never attach it to a cross-site request. With the page on `http://localhost:5173` and the API on `http://127.0.0.1:5000`, every API call is cross-site: sign-in appears to succeed, the cookie is dropped, and the next request comes back `401 Authentication required`. The dashboard then reads "Unable to load the dashboard. Authentication required", which looks like an auth bug and is really a cookie that was never sent. `credentials: "include"` cannot override it, and `SameSite=None` is not an option either, because browsers only accept it with `Secure`, which needs HTTPS.

So the two must agree on one spelling. The backend binds `127.0.0.1` (Flask listens on IPv4 only, and `localhost` resolves to `::1` first on some machines), so `127.0.0.1` is the one both sides use: the runners serve the frontend with `--host 127.0.0.1` and point `VITE_API_BASE_URL` at `http://127.0.0.1:5000`. If you start Vite yourself, pass the same flag - `npm run dev` alone binds `localhost` and the dashboard will report an authentication error.

For frontend-only commands and verification, see the [frontend README](frontend/admin/README.md#development). For feature ownership and identity relationships, see its [code navigation map](frontend/admin/README.md#code-navigation).

## Production builds

Use the tracked [production build and release recipe](deploy/README.md) for Dockerfiles, Nginx, locked dependencies, CI, and clean-commit image archives. The frontend's guarded command is `npm run build:production`; deployment uses the saved image IDs.

## Database prerequisites

The Map Editor's indoor-location markers require the `public.location` schema to support nullable latitude and longitude values. Coordinates must be stored as a complete pair and stay within the valid latitude and longitude ranges. Apply the database migration through the database team's deployment process before using indoor marker placement; the application does not alter the schema at startup.

Pathway distance and estimated time are no longer stored or returned by the application. Legacy `public.pathway.distance_m` and `public.pathway.estimated_minutes` columns are unused by the application and may remain in the database.

## Administrator email addresses

An administrator holds up to two addresses: `public.admin.gmail` and the optional `public.admin.alternative_email`. **Account recovery accepts either one**, which is the reason the second exists — the only way back into a locked-out account used to be the inbox it was created with.

`GET /api/profile` returns `alternativeEmail`, `null` when none is registered. The key's presence is what tells My Profile the server knows about the field; a build talking to an older API sees no key and hides the control.

`PATCH /api/profile` accepts `alternativeEmail` (a string, or `null`/`""` to clear) and `currentPassword`:

```json
{"username":"justine","email":"justine@example.com","alternativeEmail":"justine.home@gmail.com","currentPassword":"…"}
```

Leaving `alternativeEmail` out leaves it unchanged, so an older client that posts only `username` and `email` cannot clear it by accident.

### One shared pool

Every administrator's two addresses are **one pool**, compared trimmed and case-insensitively. An address is taken if any *other* administrator holds it as either of theirs, and an alternative cannot repeat its own primary. The database does not enforce this: accounts created before the rule already share primary addresses ([#108](https://github.com/softeng-isucamp/isu-camp-admin/issues/108)), so a unique index would fail to build. The check lives in the application (`auth.admins_holding_email`) and applies **only to the field a request is changing**, so an existing duplicate blocks nothing but a change to the duplicated field itself.

`POST /api/admins` applies the same pool. No `/api/admins` response ever carries anyone's alternative email: it is a recovery address, and that listing is readable by every active administrator.

### What the password is for

`currentPassword` is required **only when the primary or alternative email changes** — a rename alone does not ask. It is checked **before** the duplicate checks, so a session left open on a shared machine can neither move an address nor be used to probe which addresses exist.

| Field | Status | Message |
| --- | --- | --- |
| `username` | 409 | `That username is already taken` |
| `email` / `alternativeEmail` | 409 | `That email address is already in use` |
| `email` / `alternativeEmail` | 400 | `Enter a valid email address` |
| `alternativeEmail` | 400 | `Use a different address from your primary email` |
| `currentPassword` | 401 | `Your current password is incorrect`, or `Enter your current password to change an email address` when it is missing |

A conflict never names the account that holds the address. Several fields can be refused in one response: `fields` carries each of them and `message` is the first, in the order the form reads.

### Recovery

Forgot password and forgot username accept either address. The code is sent **only to the address that was typed** — mailing the primary instead would tell whoever typed the alternative that the two belong together — and the response is identical whether or not an account matches. Codes are keyed per purpose and typed address, so a code requested for one address does not verify through the other. An address two accounts hold between them recovers neither, the same as an ambiguous primary always has.

Apply `migrations/20261023_add_admin_alternative_email.sql` before using any of this.

## Recovery attempt limits

Two limits guard `/api/recovery/*`, both persistent and both measured over the same **15-minute sliding window**:

| Limit | Value | What happens past it |
| --- | --- | --- |
| Codes requested | 3 per window | 429 `recovery_restricted`, and **nothing is mailed** |
| Wrong codes guessed | 5 per window | 15-minute restriction, starting with the 5th guess itself |

Unchanged: a code still expires after **10 minutes** and a resend is still refused for **60 seconds**.

### The counts belong to an account, not to a code

A code used to carry its own budget of five guesses, which made asking for a new one the way to get five more — five guesses a minute, indefinitely, which is not a limit. The counts are now kept against a **subject**:

- an **account**, when the submitted address belongs to exactly one, so its primary and alternative addresses share a single budget and a single request cap; or
- the **address itself** otherwise — unknown, or shared by several accounts.

So the five guesses are cumulative **across resends, across both of an account's addresses, and across the password and username flows** (both verify the same inbox, so counting them apart would only double the guesses on offer). Two unrelated addresses keep their own budgets — otherwise guessing at an invented address would be a way to lock somebody else out.

### The restriction

The **5th wrong code is itself answered with the restriction**, not with `code_exhausted`. Being told "request a new one" was advice that led straight back to five more guesses.

While a subject is restricted, **every** recovery route answers 429 `recovery_restricted` with an integer `Retry-After` — including a request for a new code, so the restriction cannot be waited out by mailing yourself codes until it lifts, and **including a request carrying the correct code**. A restriction the right code could walk through would only ever hold up the people who had lost their code.

When it lifts, the whole budget comes back. Leaving the failures at the limit would restrict the account again on its very next mistake, and the next — a permanent lockout wearing a fifteen-minute label.

The failure count also **decays** once the window passes with no new failure. Five mistakes *in fifteen minutes*, not five in a lifetime: without that, an address that mistyped four codes last month would be one slip away from being locked out for good.

### What a success clears

A correct code **clears the failures** — it proves whoever is asking is reading the inbox, which is the only thing the attempt limit was there to establish, so holding four earlier typos against them afterwards protects nothing. This applies to a successful username recovery as much as to a password reset.

It deliberately **does not clear the request window**: that cap is about how much mail the form may send, and a success does not excuse it.

### Telling the two kinds of 429 apart

Both carry `Retry-After`; the frontend reads the `code`, not the message.

| `code` | Means | Scope | Typical wait |
| --- | --- | --- | --- |
| `recovery_restricted` | This account's recovery is closed for a while | the subject | minutes |
| `rate_limited` | This client is going too fast | per IP, or per IP and address | seconds |

The 60-second resend cooldown and the per-IP flood limits are `rate_limited`. The 3-per-window request cap and the 5-failure restriction are `recovery_restricted`.

`invalid_code` still carries `attemptsRemaining`, and it is now the **cumulative** figure rather than what is left on one code.

### Unknown addresses

An address with no account is counted, capped and restricted exactly like one that has an account, and receives the same status codes, bodies and `Retry-After` values. Any difference would be the answer to "does this address have an account here", which is the question the whole flow is built not to answer.

### What is stored

`public.recovery_attempt`, one row per subject, holding only counters: the failures, when the newest one landed, what the restriction runs until, and the times of the last few requests.

**No code and no password hash is ever written there.** The codes stay in process memory, so a restart still invalidates outstanding codes and the admin asks for another — losing those costs an attacker nothing, which is exactly why they are the part that may be lost. What survives a restart is the part an attacker benefits from losing, which is why it moved into the database in the first place: a restart used to clear every counter, and a second worker ran a second set of budgets alongside the first.

An address with **no account** is stored as `email:` followed by an HMAC of it keyed with `SECRET_KEY`, never as the address. The table would otherwise become a list of every address anybody has ever typed into Forgot Password, sitting in the admin database — addresses that by definition belong to people with no account here. A plain hash would not do: an email address is guessable enough that an unkeyed digest is a dictionary away from the address. Rotating `SECRET_KEY` abandons those counters, which is acceptable because rotating it already signs every session out.

Rows untouched for longer than both windows remember nothing and are deleted, which is also what keeps a flood of invented addresses from growing the table past the addresses actually seen in the last few minutes.

Within one process a lock serializes the read-decide-write; across processes `SELECT … FOR UPDATE` on the subject's row does the same, so a deployment with several workers counts once per guess rather than once per worker.

Apply `migrations/20261024_add_recovery_attempt.sql` before using any of this.

## Administrator permissions

A superadmin switches four general actions on or off for each regular administrator. **Viewing is not one of them**: it is the least-privilege minimum every active account keeps, so an administrator who should see nothing is deactivated, not given four off switches.

| Key | Allows |
| --- | --- |
| `add` | Creating things: locations, rooms, buildings, route nodes, pathways, path points, entrances, indoor locations, converting a path point to a route node, placing an unpositioned indoor marker for the first time |
| `edit` | Changing existing things: location details, building footprints, moving or reshaping route nodes, pathways and path points, linking an existing entrance, repositioning or clearing an indoor marker already on the map |
| `delete` | Deleting locations, buildings, route nodes, pathways, path points |
| `changeUserStatus` | Activating and deactivating **app users** (`PUT /api/users/:id/status`) |

**Superadmins hold every permission and cannot be configured.** Their stored switches are SQL `NULL` — the column is declared `none_as_null` so that assigning nothing stores SQL NULL and not the JSON scalar `null`, which the migration's shape constraint rejects — and `PUT /api/admins/:id/permissions` refuses them with 409; to restrict one, demote them first. Backup & Recovery and everything under `/api/admins` except `GET` and the password-reset send stay superadmin-only and are **not grantable** — no combination of the four reaches another administrator's account.

Nobody changes their own permissions.

### Reading them

`POST /api/login`, `GET /api/me` and `GET /api/admins` all carry the same object:

```json
{"id":"7","username":"registrar","email":"…","role":"admin",
 "permissions":{"add":true,"edit":false,"delete":false,"changeUserStatus":true}}
```

**`null` — or a missing key — means all four are on.** That is what makes the column safe to add to a running deployment: a row nobody has configured, and every row written before the migration, keeps the access it had. A superadmin reports `null` for the same reason the role does not need switches.

`GET /api/me` reads them **from the row on every call**, never from the session cookie, and so does every guard below. Withdrawing a permission therefore takes effect on the administrator's **next request** — there is no cached grant to outlive it, and nobody has to sign out and in again.

### Setting them

`PUT /api/admins/:id/permissions`, superadmin-only and behind a recent password confirmation (`/api/confirm-password`), the same pattern as `/role`:

```json
{"permissions":{"add":true,"edit":true,"delete":false,"changeUserStatus":false}}
```

All four keys, every time, each a boolean — a body naming two leaves the other two to whatever the reader assumes. Anything else is a 400 with `fields.permissions`.

**Absent and null are different things.** Leaving `permissions` out of a create or a demotion takes the default (all four off); sending it as `null` is a value the caller chose, and the only shape a supplied value may take is the four booleans, so it is refused like any other wrong shape. Reading the two the same way meant a client asking for "no permissions" silently got the view-only default instead of being told its request made no sense. A supplied value is still **ignored** for a superadmin target, `null` included — a client may hold one form for both roles, and a field that cannot apply must not fail the request.

| Case | Status | Message |
| --- | --- | --- |
| The target is the caller | 409 | `You cannot change your own permissions.` |
| The target is a superadmin | 409 | `Superadmins always have every permission. Demote them first to restrict them.` |
| A partial or mistyped set | 400 | `Each of the four permissions must be given as true or false.` |
| Done | 200 | `Permissions updated for <username>.` plus the updated `admin` |

The audit row records what moved — `admin02: add: on -> off; delete: on -> off` — so the Logs page answers "who took that away" without anybody diffing two rows.

**Defaults.** The migration backfills existing administrators with all four **on**, because a migration must not quietly take away what everyone could do yesterday. New accounts and demoted superadmins start with all four **off** unless the request says otherwise: an account being set up has not been given anything yet. `POST /api/admins` and `PUT /api/admins/:id/role` both accept an optional `permissions` object; a promotion discards it.

`POST /api/admins` now requires a password confirmation for **every** create, not only a superadmin's — each new account is a new way into the portal whatever its role.

**`DELETE /api/admins/:id` is gone** and answers 405. Removing the row orphaned everything the account had ever done, since the audit trail names an actor by username; `PUT /api/admins/:id/status` does the same job and keeps the history readable.

### The server is the enforcement

The frontend hides what the signed-in administrator may not do, but hiding a button is not authorization. Every write route checks for itself, through `auth.permission_required` (or `auth.permission_error` where a route has already loaded its caller), and a refusal is:

```json
{"success":false,"code":"PERMISSION_DENIED","message":"You don't have permission to do that. Ask a superadmin."}
```

with status **403**. The frontend reads the `code`, not the message.

On a delete, the **permission is checked before the password confirmation** — as with `superadmin_required` — so an administrator who may not delete is refused outright rather than asked to confirm a password for an answer that was never going to be yes.

### Operations, not request verbs

Two routes are judged on what the operation *is* rather than on which records it happens to write:

- **`PATCH /api/map/buildings/:id/indoor-locations/:id`** needs `add` to give an indoor location its first marker and `edit` to move or clear one it already has. Which of the two it is comes from the marker's **stored coordinates**, so a client cannot pick the permission it is judged against.

- **`PUT /api/pathways/:id/points`** replaces a pathway's whole point sequence as one `edit`, in one transaction. Reshaping a pathway stores new vertex records and drops old ones; reconciled one vertex at a time it reached the server as an add, an edit and a delete, so an administrator who may edit the network could only drag a shape that kept its vertex count — and a refusal partway through left the pathway with half of its new shape. Creating a pathway carries its vertices in the same request (`POST /api/pathways`), so that stays one `add`, and Create Junction / Convert to Route Node (`POST /api/pathways/:id/convert-point`) is one `add` including the graph rewiring it requires.

`POST /api/map/save` is checked **per change in the payload**, before the first one is applied: one refused change refuses the whole save, and the message names it (`You don't have permission to change the Engineering Hall footprint. Ask a superadmin.`). Everything that route can apply is a change to a record that already exists, so every change in it is an `edit`; an empty draft asks for nothing and needs nothing.

`POST /api/map/publish` is open to every active administrator and none of the four gates it: publishing promotes work that is already saved, and the saving is what each permission was checked on.

Apply `migrations/20261024_add_admin_permissions.sql` before using any of this.

## Database backups

Backup & Recovery on My Profile takes real `pg_dump` archives. These routes back it, all superadmin-only:

| Route | Purpose |
| --- | --- |
| `GET /api/backups` | Stored archives, the running job if there is one, and which controls this server can serve |
| `POST /api/backups` | Start a dump; returns a job to poll |
| `POST /api/backups/<id>/restore` | Restore an archive; needs the caller's password |
| `POST /api/backups/<id>/download` | Issue a one-time download link; needs the caller's password |
| `DELETE /api/backups/<id>` | Delete one archive; needs a recent password confirmation |
| `PUT /api/backups/schedule` | Save the automatic backup schedule |
| `GET /api/jobs/<id>` | Poll one operation until it is terminal |
| `POST /api/jobs/<id>/cancel` | Ask a running backup or restore to stop |

`GET /api/backup-downloads/<token>` streams one archive and is the only route here with no session check: the browser's own downloader fetches it, so it is authorised by the token instead.

The archive is `pg_dump`'s custom format, so `pg_restore` can list it, pull one table out of it, or restore all of it with no code from this repository involved. That is the reason for preferring it to an application-level export. Measured against this project: **75 MB in about a minute**, covering all 17 tables of the `public` schema. It was 24 MB in 1 minute 45 seconds when this was written; the growth is `building_photo` and `location_photo`, which store image bytes in the database, so size retention against a fresh measurement rather than against this sentence.

These are jobs rather than plain responses because of that runtime. The API runs `gunicorn --timeout 120`, so a synchronous dump would be killed before finishing. `POST /api/backups` returns `202` with `{id, kind, status}` and the panel polls `GET /api/jobs/<id>` every 1.5 seconds.

### Every control is advertised, not assumed

`GET /api/backups` carries `canDownload`, `canDelete` and `schedule`, and a job carries `cancellable`. **A key that is missing hides its control**, which is what lets the frontend and the backend land separately: a build talking to a deployment that has only half of this offers only the half that works, rather than a button that 404s. An unreadable `schedule` — a deployment that has not applied `migrations/20261023_add_backup_schedule.sql` — is treated the same as a missing one.

### Cancelling

`POST /api/jobs/<id>/cancel` answers `202` with the job as it stands, usually still `running`: the tool has been asked to stop, not finished stopping, and the panel shows "Cancelling…" while it keeps polling. The terminal status is `cancelled`, alongside `succeeded` and `failed`.

- **A cancelled backup leaves nothing behind** — no archive, no history row, and the partial file is removed.
- **A cancelled restore leaves the database exactly as it was.** `pg_restore` runs with `--single-transaction`, so terminating it abandons the transaction rather than leaving the schema half replaced.
- **A lost race reports the real outcome.** A dump that had already written its last byte did succeed, and calling that `cancelled` would be a lie about an archive that now exists.
- **Any superadmin can cancel any job**, including one the schedule started: whoever is watching a dump compete with the thing they need the database for is the person who should be able to stop it.

Once an operation is past its point of no return it reports `cancellable: false` instead of accepting a cancel, so the button goes away rather than appearing to work.

### Downloading and deleting

`POST /api/backups/<id>/download` re-checks the password and returns `{url, expiresAt}`. The link is unguessable, **single-use**, expires in three minutes, and streams with `Content-Disposition: attachment`. Only a `ready` archive can be downloaded; anything else answers `404`, and so does an archive that is not there — the password is checked first, so a session left open cannot be used to ask which archives exist.

`DELETE /api/backups/<id>` answers `204` and uses the portal's existing re-authentication convention rather than a password in the body: a lapsed confirmation answers `403` with `{"code":"password_confirmation_required"}`, the same code every other delete uses. It works on `ready` and `failed` archives, refuses with `409` while any backup or restore is running, and will delete the last archive you have — the UI warns about that; the server does not pretend an archive nobody wants is made safe by being the only one.

### Automatic backups

One dump on a schedule, taken by a thread inside the API process (`app/services/backup_schedule.py`). It calls the same `start_backup` as the panel's button, so an automatic archive differs from a hand-made one only in its `createdBy`, lands in the same list, and is restored the same way. There is no scheduler library and no cron entry to keep in step with the code.

**The schedule is a database row** (`public.backup_schedule`, one row), saved from the panel and re-read by the thread every minute, so a change takes effect without restarting the API. These three environment variables seed that row the **first time it is read** and are ignored afterwards:

| Setting | Seeds | What it meant |
| --- | --- | --- |
| `BACKUP_SCHEDULE_ENABLED` | `enabled` (default off) | `true`, `1` or `yes` to start switched on |
| `BACKUP_SCHEDULE_AT` | `time` (default `02:30` Manila) | A **UTC** time of day, converted on the way in: 18:30 UTC is 02:30 Philippine time |
| `BACKUP_KEEP` | `keep` (default `14`) | Archives kept after each completed backup |

The saved schedule is `{enabled, frequency, day, time, timeZone, keep}`: `frequency` is `daily` or `weekly`, `day` is 0–6 with Sunday as 0 (required for weekly, `null` for daily), `time` is 24-hour `HH:MM`, and `timeZone` is always `Asia/Manila` — the time of day is **local**, and the server converts. A quiet hour is a local hour, so storing 18:30 UTC instead would make 02:30 a fact somebody has to recompute every time they read the row.

Switching it off keeps the other fields, so switching it back on restores the schedule somebody set rather than a default they have to re-enter. The timer therefore runs whether or not the schedule is currently on: being off is a value in the row, and a thread that only started when the row said "on" could never see it change to "on".

Things to know:

- **Retention deletes archives that people took by hand.** It keeps the newest `keep` files in the directory whoever made them, because the limit is about disk rather than about authorship. At today's ~75 MB a dump, the default is a little over 1 GB. It runs **after each completed backup**, so a button press is held to the same limit as a scheduled run — and **saving a schedule deletes nothing by itself**, so lowering `keep` is never a delete somebody did not expect.
- **A missed night is picked up at startup.** If the newest archive is more than a day old, a backup runs two minutes after the process starts instead of waiting for the next scheduled minute, because a development machine is rarely awake at 02:30. A restart an hour after a successful run does not take another.
- **Starting it in two processes is safe.** Each run is claimed by creating a `.claimed-<time>` marker in the backup directory with `O_EXCL`, so `flask --debug` (which runs the app twice) or a second gunicorn worker still produces one dump rather than two writing the same file. Because the marker outlives the process, a restart does not re-take a night that was already taken.
- **Every run reaches the audit log** as a `System` row with actor `scheduler` — `backup`, `backup failed`, or `backup skipped` when somebody's own job was already running. Download, delete, cancel and a schedule change are `System` rows too, naming the administrator who did it; a retention removal names the archive it took. No row ever carries a password or a download link. The Logs page shows these under All.

An unfinished dump is no longer mistaken for a backup. `pg_dump` creates its output file immediately and fills it as it reads, so a run that died part way through — a dropped pooler connection mid `building_photo` has happened here — used to leave a truncated file that the panel listed as ready to restore from. A dump now writes `<id>.dump.partial` and is renamed to `<id>.dump` only once the tool has exited cleanly, and leftovers are swept before each automatic run.

### What a deployment needs

Two things, both of which the production recipe in [`deploy/`](deploy/README.md) now provides:

1. **`pg_dump` and `pg_restore` must be on the server.** Without them a backup fails with a clear `503` rather than a crash. The client must be **17 or newer**: Supabase runs 17.6, and a 15 client refuses to dump a 17 server — which is what Debian bookworm's own `postgresql-client` would give you. `deploy/admin-api.Dockerfile` installs `postgresql-client-17` from the PostgreSQL APT repository for exactly that reason. `PG_DUMP_PATH` and `PG_RESTORE_PATH` point at specific binaries when the ones on `PATH` are the wrong version.
2. **The archive directory must outlive the container.** Archives are written to `BACKUP_DIR` (default `backups/`, gitignored), and a path inside a container disappears on the next deployment. `deploy/compose.yaml` sets `BACKUP_DIR=/srv/backups` and mounts the external volume `kumpas-admin-backups` there; the volume has to be created once before the first deployment that uses it.

Check both on any deployment that is not built from that recipe, because the schedule is seeded off and switching it on is now a decision somebody makes in the panel rather than in a deployment's environment. On a server missing either one, every night fails — visibly, in the audit log, rather than quietly.

Locally neither applies: `pg_dump` arrives with pgAdmin or any PostgreSQL install, and `backups/` persists.

### Restoring is off by default

`POST /api/backups/<id>/restore` answers `403` unless `BACKUP_RESTORE_ENABLED=true`. A restore runs `pg_restore --clean --if-exists --single-transaction` over the live `public` schema: it replaces every table, including `public.admin`, in a database the companion User App also reads. It undoes other people's work, not just the caller's. The flag exists so enabling it is a decision somebody makes on purpose rather than a button that happens to be present.

The caller's password is required and is checked **before** the flag, so a caller who cannot authenticate learns nothing about whether restoring is available.

**An archive is a complete copy of the database, including the `public.admin` password hashes.** Treat a `.dump` file as credential material: `backups/` is gitignored, a download link is a bearer token for exactly that, and a copy moved anywhere else needs the same care.
