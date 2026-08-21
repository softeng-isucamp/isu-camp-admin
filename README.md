# ISU-CAMP Admin

This repository contains the ISU-CAMP administration backend scaffold and the admin frontend.

## Repository layout

- `app/` contains the Python backend modules.
- `frontend/admin/` contains the Vite, React, and TypeScript admin portal.
- `static/` and `templates/admin/` are reserved for Flask-managed assets and templates.

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

