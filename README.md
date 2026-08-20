# ISU-CAMP Admin

This repository contains the ISU-CAMP administration backend scaffold and the admin frontend.

## Repository layout

- `app/` contains the Python backend modules.
- `frontend/admin/` contains the Vite, React, and TypeScript admin portal.
- `static/` and `templates/admin/` are reserved for Flask-managed assets and templates.

## Admin frontend

Run frontend commands from `frontend/admin`:

```bash
cd frontend/admin
npm install
npm run dev
```

See `frontend/admin/README.md` for demo credentials and verification commands. Flask integration and production asset generation are intentionally outside this frontend migration.
