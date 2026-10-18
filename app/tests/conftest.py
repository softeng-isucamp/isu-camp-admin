import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]

for path in (APP_ROOT, APP_ROOT / "routes", APP_ROOT / "services"):
    entry = str(path)
    if entry not in sys.path:
        sys.path.insert(0, entry)


# Pathway names PathPoint and PathwayAllowedMode by string in its relationships.
# Register them here so any subset of tests can configure the mapper registry,
# not only runs that happen to collect the dashboard tests.
from model.path_point import PathPoint  # noqa: E402,F401
from model.pathway import Pathway  # noqa: E402,F401
from model.pathway_allowed_mode import PathwayAllowedMode  # noqa: E402,F401
