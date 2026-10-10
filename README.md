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
| Fixture | `./dev.sh --fixture` | `dev.bat --fixture` | `.\dev.ps1 --fixture` | Starts only the frontend with the local adapter and OSM fixture. No Flask or database required. Login: `admin_justine` / `password123`. |

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
