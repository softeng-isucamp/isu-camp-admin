import importlib
import pkgutil
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]

for path in (APP_ROOT, APP_ROOT / "routes", APP_ROOT / "services"):
    entry = str(path)
    if entry not in sys.path:
        sys.path.insert(0, entry)


# Every model, imported for its side effect of registering itself.
#
# The models name each other by string - Pathway's relationships name PathPoint
# and PathwayAllowedMode, and the foreign keys name tables like
# "public.building" - and SQLAlchemy only resolves those names once the class
# that defines them has been imported. A test file that creates the metadata
# without them gets NoReferencedTableError from db.metadata.create_all() for a
# table nothing in that file mentions, which fails every test in the file at
# the fixture, with an error that names a module the test never touched. Taking
# the whole package means a new model, or a new foreign key between two
# existing ones, cannot break an unrelated test file by being added.
for module in pkgutil.iter_modules([str(APP_ROOT / "model")]):
    importlib.import_module(f"model.{module.name}")
