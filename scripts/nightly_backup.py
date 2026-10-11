"""One scheduled database backup. Run by the OS scheduler, not by Flask.

    python scripts/nightly_backup.py

Outside the web process on purpose, for three reasons:

* A timer inside Flask only fires while Flask happens to be running, and the
  backend is not running at 8pm on a laptop that has been closed.
* Flask's debug reloader runs two processes, so an in-process timer fires
  twice. gunicorn with more than one worker would fire once per worker.
* A scheduler wants an exit code and a log line, which is what this gives it.

Exits 0 when an archive was written, 1 otherwise, so a failed night is visible
to Task Scheduler or cron rather than silent. Every run appends one line to
``nightly.log`` beside the archives.
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for entry in (ROOT / "app", ROOT / "app" / "services", ROOT / "app" / "routes"):
    if str(entry) not in sys.path:
        sys.path.insert(0, str(entry))

from dotenv import load_dotenv  # noqa: E402

# Same order the app uses, so the scheduled run reads one configuration.
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "app" / "services" / ".env")

from services.backup_jobs import (  # noqa: E402
    BackupError,
    backup_directory,
    clear_partial_archives,
    prune_backups,
    run_backup,
)

ACTOR = "scheduled"


def log(message):
    """One timestamped line, to the console and to nightly.log."""

    line = f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}Z  {message}"
    print(line, flush=True)
    try:
        with open(backup_directory() / "nightly.log", "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        # A log that cannot be written must not fail the backup itself.
        pass


def main():
    log("starting scheduled backup")

    # Clear leftovers from a dump that was interrupted, so they do not
    # accumulate unnoticed in the archive directory.
    abandoned = clear_partial_archives()
    if abandoned:
        log(f"removed {len(abandoned)} unfinished archive(s) from an earlier run")

    try:
        result = run_backup(ACTOR)
    except BackupError as failure:
        log(f"FAILED: {failure}")
        return 1
    except Exception as failure:  # noqa: BLE001 - the scheduler needs a reason
        log(f"FAILED: unexpected error: {failure}")
        return 1

    log(f"wrote {result['id']} ({result['sizeBytes']:,} bytes)")

    # Pruned after a successful dump, never before: a failed backup must not be
    # the reason an older one was deleted.
    try:
        removed = prune_backups()
        if removed:
            log(f"pruned {len(removed)} old archive(s): {', '.join(removed)}")
    except BackupError as failure:
        log(f"retention skipped: {failure}")

    keep = os.getenv("BACKUP_KEEP", "14")
    log(f"done; keeping the newest {keep}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
