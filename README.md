# ISU-CAMP Admin

This repository contains the ISU-CAMP administration backend scaffold and the admin frontend.

## Repository layout

- `app/` contains the Python backend modules.
- `frontend/admin/` contains the Vite, React, and TypeScript admin portal.
- `static/` is reserved for Flask-managed assets.

## Running Backend & Frontend

### Unified Runner (Recommended)

You can launch both the Flask backend and the React frontend simultaneously using a single command from the project root:

**Linux / macOS (Bash):**
```bash
./dev.sh
```

**Windows (Command Prompt):**
```cmd
dev.bat
```

**Windows (PowerShell):**
```powershell
.\dev.ps1
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

See `frontend/admin/README.md` for demo credentials and verification commands.


---

## Security configuration

Settings come from `.env`. Copy `.env.example` to `.env` and fill it in; that
file documents every variable inline. `.env` is gitignored and must never be
committed.

Three must be set before deploying:

| Variable | Why it matters |
| :--- | :--- |
| `SECRET_KEY` | Signs the admin session cookie, so a shared or guessable value lets anyone forge an authenticated admin session. The app refuses to start without it outside development. Generate one with `python -c "import secrets; print(secrets.token_hex(32))"`. |
| `ADMIN_ALLOWED_ORIGINS` | Origins allowed to call the API with credentials, comma separated. Acts as both the CORS allowlist and the origin check on state-changing requests, so it must name the real admin portal URL. |
| `ISUCAMP_ENV` | Leave unset or `production` in any deployment. Only `development` relaxes the `SECRET_KEY` requirement and allows the session cookie over plain HTTP. |

`FLASK_DEBUG` must stay off everywhere: the Werkzeug debugger offers an
interactive Python console on any traceback. The `dev.sh`, `dev.bat`, and
`dev.ps1` runners export `ISUCAMP_ENV=development` for you, so a local
`http://localhost` run needs no extra setup.

### Admin accounts and passwords

Passwords are stored as PBKDF2-SHA256 hashes. `app/services/manage_admins.py`
handles all three password tasks and always hashes locally, so the password
itself never reaches the database:

```powershell
venv\Scripts\python.exe app\services\manage_admins.py create     # new account, end to end
venv\Scripts\python.exe app\services\manage_admins.py hash       # print a hash to paste into Supabase
venv\Scripts\python.exe app\services\manage_admins.py backfill   # hash rows that are still plaintext
```

On macOS and Linux, use `venv/bin/python` in place of `venv\Scripts\python.exe`.

**Never type a plaintext password into the Supabase table editor.** It is
written to the query log and the WAL before anything can hash it, so the
exposure happens the moment you save the row; hashing it afterwards does not
undo that. Use `create`, or `hash` and paste the result.

A row that already holds a plaintext password is not broken. The account signs
in normally and the login route replaces the column with a hash on that first
successful sign-in, with no password change required. `backfill` converts rows
nobody has signed into.

To make the mistake impossible, apply
`migrations/20260926_enforce_hashed_admin_password.sql`. It adds a `CHECK`
constraint rejecting any `admin.password` that is not a hash. Run `backfill`
first, or the constraint fails on existing plaintext rows. Note that
`migrations/` is gitignored here, so that file is local to your checkout.

New passwords must be at least 10 characters with a letter and a number, and
must not contain the username. The rule lives in `app/services/security.py`;
`frontend/admin/src/services/schemas.ts` mirrors it so the form validates
inline.

### What the backend enforces

- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, and
  expire after `SESSION_IDLE_MINUTES` of inactivity.
- State-changing requests from an origin outside the allowlist are rejected
  with `403`, behind the `SameSite` cookie policy as a second layer.
- Every `/api` route requires an authenticated admin session.
- Login and every password-reset step are rate limited per IP; login is also
  rate limited per username.
- Password reset never reveals whether a username exists, and a verification
  code is discarded after five wrong guesses.
- Photo uploads are accepted only if their leading bytes prove they are PNG,
  JPEG, or WebP; a client-supplied `Content-Type` is not trusted.
- Error responses carry no driver or ORM detail; the traceback goes to the
  server log instead.
