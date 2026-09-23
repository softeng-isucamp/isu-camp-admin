import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]

for path in (APP_ROOT, APP_ROOT / "routes", APP_ROOT / "services"):
    entry = str(path)
    if entry not in sys.path:
        sys.path.insert(0, entry)
