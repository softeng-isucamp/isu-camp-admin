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
| Fixture | `./dev.sh --fixture` | `dev.bat --fixture` | `.\dev.ps1 --fixture` | Starts only the frontend with the local adapter and OSM fixture. No Flask or database required. Logins, all with `password123`: `admin_justine` and `admin_dean` (superadmins), `admin_registrar` (administrator). |

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

## Database backups

Backup & Recovery on My Profile takes real `pg_dump` archives. Four routes back it, all superadmin-only:

| Route | Purpose |
| --- | --- |
| `GET /api/backups` | Stored archives, plus the running job if there is one |
| `POST /api/backups` | Start a dump; returns a job to poll |
| `POST /api/backups/<id>/restore` | Restore an archive; needs the caller's password |
| `GET /api/jobs/<id>` | Poll one operation until it is terminal |

The archive is `pg_dump`'s custom format, so `pg_restore` can list it, pull one table out of it, or restore all of it with no code from this repository involved. That is the reason for preferring it to an application-level export. Measured against this project: **24 MB in about 1 minute 45 seconds**, covering all 17 tables of the `public` schema.

These are jobs rather than plain responses because of that runtime. The API runs `gunicorn --timeout 120`, so a synchronous dump would be killed before finishing. `POST /api/backups` returns `202` with `{id, kind, status}` and the panel polls `GET /api/jobs/<id>` every 1.5 seconds.

### What a deployment needs

Two things that are **not** in place today:

1. **`pg_dump` and `pg_restore` must be on the server.** The API image (`python:3.12-slim-bookworm`) does not include them, so a deployed backup fails with a clear `503` rather than a crash. Debian bookworm's `postgresql-client` is version 15, and **a 15 client refuses to dump a 17 server** — Supabase runs 17.6, so the client must be 17 or newer. Installing that needs the PostgreSQL APT repository, which would add an unpinned source to an image that otherwise pins its base by digest and its Python packages by hash. That trade is a deliberate decision, so it has not been made here. Set `PG_DUMP_PATH` and `PG_RESTORE_PATH` to point at specific binaries.
2. **The archive directory must outlive the container.** Archives are written to `BACKUP_DIR` (default `backups/`, gitignored). `deploy/compose.yaml` mounts no volume, so in a container they would disappear on the next deployment. Mount a volume at the configured path, or move storage to object storage.

Locally neither applies: `pg_dump` arrives with pgAdmin or any PostgreSQL install, and `backups/` persists.

### Scheduled nightly backups

`scripts/nightly_backup.py` takes one backup and exits: `0` if an archive was written, `1` otherwise, with a line appended to `backups/nightly.log` either way.

```sh
python scripts/nightly_backup.py
```

It runs **outside** the web process deliberately. A timer inside Flask only fires while Flask happens to be running, which it is not at 8pm on a laptop that has been closed; Flask's debug reloader runs two processes, so an in-process timer fires twice; and gunicorn would fire once per worker. A scheduler wants an exit code, which this gives it.

Register it on Windows — one command, in PowerShell as administrator, with `$root` set to this checkout:

```powershell
$root = "C:\Users\justine asuncion\OneDrive\Documents\SoftwarEng\isumap\isu-camp-backup"
Register-ScheduledTask -TaskName "ISU-CAMP nightly backup" `
  -Action (New-ScheduledTaskAction -Execute "$root\venv\Scripts\python.exe" `
           -Argument "scripts\nightly_backup.py" -WorkingDirectory $root) `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 8pm) `
  -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) `
  -Description "Nightly pg_dump of the ISU-CAMP public schema."
```

`-StartWhenAvailable` runs a missed backup as soon as the machine is next awake, so a laptop that was shut at 8pm still gets one.

On a Linux host, cron instead:

```
0 20 * * * cd /srv/isu-camp-admin && venv/bin/python scripts/nightly_backup.py
```

Two things to expect. **Cron and Task Scheduler fire in the machine's local time, while the log timestamps are UTC** — an 8pm Manila run appears in the log as `12:00Z`. And **a dump takes between about 2 and 5 minutes**, varying with pooler latency; the script gives up after 10.

### Retention

Each archive is about 24 MB, so a nightly schedule is roughly 730 MB a month. After a successful dump the script deletes all but the newest `BACKUP_KEEP` archives (default 14), taking each one's metadata with it. Pruning happens only after a dump succeeds, so a failed backup is never the reason an older one was removed. A `BACKUP_KEEP` below 1 is refused rather than honoured.

A dump in progress writes to a `.dump.partial` name and is renamed only once `pg_dump` exits cleanly. The listing only ever shows `*.dump`, so a backup interrupted by a crash or a restart is never offered for restore; the next scheduled run clears the leftover.

### Restoring is off by default

`POST /api/backups/<id>/restore` answers `403` unless `BACKUP_RESTORE_ENABLED=true`. A restore runs `pg_restore --clean --if-exists --single-transaction` over the live `public` schema: it replaces every table, including `public.admin`, in a database the companion User App also reads. It undoes other people's work, not just the caller's. The flag exists so enabling it is a decision somebody makes on purpose rather than a button that happens to be present.

The caller's password is required and is checked **before** the flag, so a caller who cannot authenticate learns nothing about whether restoring is available.

**An archive is a complete copy of the database, including the `public.admin` password hashes.** Treat a `.dump` file as credential material: `backups/` is gitignored, and a copy moved anywhere else needs the same care.
