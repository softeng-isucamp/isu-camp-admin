"""The automatic backup: a thread that takes the panel's dump on a timer.

There is no scheduler library here on purpose. ``start_backup`` is the whole
operation, so the automatic backup is a caller on a timer rather than a second
implementation: this module decides *when*, and ``services.backup_jobs`` still
decides *how*. Everything the panel shows - the archive, its sidecar, the job -
comes out the same, and an automatic run is distinguishable only by its
``createdBy``.

Two things make the timer safe to start in more than one process, which matters
because ``flask --debug`` runs this module twice and a second gunicorn worker
would be a third:

* a run is claimed by creating a marker file with ``O_EXCL``, so the first
  process to reach a given minute takes that night and the others skip it, and
* the claim outlives the process, so a restart does not re-dump a night that
  has already been taken.

Off unless ``BACKUP_SCHEDULE_ENABLED`` is set. A deployment cannot run this at
all yet - the API image has no ``pg_dump`` and ``backups/`` is not a mounted
volume - so switching it on is a decision somebody makes after fixing both,
rather than a default that fails quietly every night. See the backup section of
the README.
"""

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from extensions import db
from services.audit import log_audit
from services.backup_jobs import (
    TERMINAL_STATUSES,
    BackupError,
    backup_directory,
    get_job,
    iso_utc,
    list_backups,
    prune_archives,
    start_backup,
    sweep_unfinished,
)

# 18:30 UTC is 02:30 in Philippine time, which is the quiet hour for a campus
# system. The setting is UTC because every other timestamp in this feature is
# UTC, and converting in one direction only is one fewer thing to get wrong
# when reading a log at three in the morning.
DEFAULT_AT = "18:30"

# Fourteen days of history, which is about 1 GB at the current database size.
DEFAULT_KEEP = 14

# What an automatic archive calls itself in the panel's "Created by" column.
ACTOR = "scheduled"

# Who the audit row names. The archive says how it was made; the log says who
# made it, and "scheduled" would read there as a person.
AUDIT_ACTOR = "scheduler"

# A missed night is picked up this long after start, not immediately: a dump
# competes with everything else a booting server is doing, and a restart loop
# should not fire one on every attempt.
CATCHUP_DELAY_SECONDS = 120

# How often the running dump is checked, and the longest the timer sleeps in
# one go - short enough that a stop, or a corrected clock, is noticed promptly.
POLL_SECONDS = 5
SLEEP_SLICE_SECONDS = 60

# Claim markers are tiny and empty, but there is no reason to keep every night
# of them for ever.
CLAIMS_KEPT = 60

logger = logging.getLogger(__name__)

_thread = None
_stop = None
_lock = threading.Lock()


# ==========================================
# Settings
# ==========================================

def schedule_enabled():
    """Whether the automatic backup is switched on for this deployment."""

    return os.getenv("BACKUP_SCHEDULE_ENABLED", "").strip().lower() in ("1", "true", "yes")


def schedule_time():
    """The daily run time as ``(hour, minute)`` in UTC."""

    raw = (os.getenv("BACKUP_SCHEDULE_AT") or "").strip() or DEFAULT_AT
    try:
        hours, _, minutes = raw.partition(":")
        hour, minute = int(hours), int(minutes)
        if not (0 <= hour < 24 and 0 <= minute < 60):
            raise ValueError(raw)
    except ValueError:
        logger.warning(
            "BACKUP_SCHEDULE_AT is not a 24-hour HH:MM time (%r); using %s UTC",
            raw, DEFAULT_AT,
        )
        hour, minute = (int(part) for part in DEFAULT_AT.split(":"))
    return hour, minute


def keep_count():
    """How many archives to keep, never fewer than one."""

    raw = (os.getenv("BACKUP_KEEP") or "").strip()
    if not raw:
        return DEFAULT_KEEP
    try:
        return max(1, int(raw))
    except ValueError:
        logger.warning("BACKUP_KEEP is not a number (%r); keeping %d", raw, DEFAULT_KEEP)
        return DEFAULT_KEEP


def next_run_after(moment):
    """The next time a backup is due, strictly after ``moment``."""

    hour, minute = schedule_time()
    moment = moment.astimezone(timezone.utc)
    due = moment.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due <= moment:
        due += timedelta(days=1)
    return due


# ==========================================
# Claiming a Run
# ==========================================

def _claim_path(due):
    return backup_directory() / f".claimed-{due.strftime('%Y%m%d-%H%M')}Z"


def claim(due):
    """Takes the run due at ``due`` for this process, or returns False.

    ``O_EXCL`` is the whole mechanism: creating the marker either succeeds, in
    which case this process owns that night, or it fails because another
    process - or this one before a restart - already owns it.
    """

    marker = _claim_path(due)
    try:
        handle = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    except OSError:
        # Without a writable directory there is nowhere to put the archive
        # either, so let the run proceed and fail where the reason is clear.
        logger.warning("Could not record a claim for the %s run", iso_utc(due))
        return True

    try:
        os.write(handle, iso_utc(datetime.now(timezone.utc)).encode("utf-8"))
    finally:
        os.close(handle)
    return True


def _forget_old_claims():
    markers = sorted(backup_directory().glob(".claimed-*"), reverse=True)
    for marker in markers[CLAIMS_KEPT:]:
        try:
            marker.unlink()
        except OSError:
            continue


# ==========================================
# One Run
# ==========================================

def _age_of_newest_archive():
    """How long since the newest archive was taken, or None if there is none."""

    items = list_backups()
    if not items:
        return None

    try:
        taken = datetime.fromisoformat(str(items[0]["createdAt"]).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if taken.tzinfo is None:
        taken = taken.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - taken


def is_overdue():
    """Whether a day has gone by with no backup at all.

    A development machine is rarely awake at the scheduled minute, and a server
    that was down overnight should not wait for the next one. The window is a
    whole day rather than the time since the last run, so a restart an hour
    after a successful backup does not take another.
    """

    age = _age_of_newest_archive()
    return age is None or age >= timedelta(days=1)


def _record(app, action, archive_id, detail):
    """Writes one audit row, so the Logs page shows the unattended runs too.

    Best effort by design. If the database is the thing that is broken then the
    attempt still belongs in the process log, and a failure to write history
    must not take the only thread that makes backups down with it.
    """

    if app is None:
        return

    try:
        with app.app_context():
            try:
                log_audit("System", AUDIT_ACTOR, action, "Database", archive_id, detail)
                db.session.commit()
            except Exception:
                db.session.rollback()
                raise
    except Exception:
        logger.exception("Could not record an automatic backup in the audit log")


def _wait_for_job(job_id, stop=None):
    """Blocks until a job is finished, and hands back how it ended."""

    while True:
        view = get_job(job_id)
        if view is None or view["status"] in TERMINAL_STATUSES:
            return view
        # A stop does not cancel the dump - it is a subprocess with its own
        # timeout, and a half-written archive is worse than a late one - so
        # this keeps waiting and lets the process exit when the dump is done.
        _sleep(stop, POLL_SECONDS)


def run_backup_now(app=None):
    """Takes one automatic backup, applies retention, and records the outcome.

    Returns the finished job, or None if it never started. Raises nothing: this
    runs on a thread with nobody to report an exception to.
    """

    swept = sweep_unfinished()
    if swept:
        logger.info("Removed %d unfinished archive(s) from an earlier run", swept)

    try:
        job = start_backup(ACTOR)
    except BackupError as refusal:
        # A 409 here is the system working: somebody is already dumping or
        # restoring, and their job is the backup this run wanted.
        logger.warning("The automatic backup did not start: %s", refusal)
        _record(app, "backup skipped", None, str(refusal)[:500])
        return None
    except Exception:
        logger.exception("The automatic backup could not be started")
        return None

    view = _wait_for_job(job["id"])

    if not view or view["status"] != "succeeded":
        message = (view or {}).get("message") or "The backup did not finish."
        logger.error("The automatic backup failed: %s", message)
        _record(app, "backup failed", None, message[:500])
        return view

    expired = prune_archives(keep_count())
    _forget_old_claims()

    stored = list_backups()
    archive_id = stored[0]["id"] if stored else None
    detail = f"Automatic backup {archive_id} completed"
    if expired:
        detail += f"; removed {len(expired)} archive(s) past the {keep_count()} kept"

    logger.info("%s", detail)
    _record(app, "backup", archive_id, detail)
    return view


# ==========================================
# The Timer
# ==========================================

def _sleep(stop, seconds):
    """Waits, and reports True if it was told to stop instead."""

    if stop is None:
        time.sleep(seconds)
        return False
    return stop.wait(seconds)


def _loop(app, stop):
    if is_overdue() and not _sleep(stop, CATCHUP_DELAY_SECONDS):
        # The night that has just gone by, which is the one that was missed.
        missed = next_run_after(datetime.now(timezone.utc)) - timedelta(days=1)
        if claim(missed):
            logger.info("No backup in the last day; taking one now")
            run_backup_now(app)

    while not stop.is_set():
        due = next_run_after(datetime.now(timezone.utc))
        logger.info("The next automatic backup is due at %s", iso_utc(due))

        while not stop.is_set():
            remaining = (due - datetime.now(timezone.utc)).total_seconds()
            if remaining <= 0:
                break
            if _sleep(stop, min(remaining, SLEEP_SLICE_SECONDS)):
                return

        if stop.is_set():
            return

        try:
            if claim(due):
                run_backup_now(app)
            else:
                logger.info("The %s run was already taken", iso_utc(due))
        except Exception:
            # The timer is the only thing that makes automatic backups, so it
            # outlives any one failed night.
            logger.exception("The automatic backup at %s ended badly", iso_utc(due))


def start_scheduler(app=None):
    """Starts the timer if it is switched on. Returns the thread, or None.

    ``app`` is only needed to write audit rows, so the timer runs without one.
    """

    global _thread, _stop

    if not schedule_enabled():
        return None

    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread

        hour, minute = schedule_time()
        logger.info(
            "Automatic backups are on: %02d:%02d UTC daily, keeping %d",
            hour, minute, keep_count(),
        )

        _stop = threading.Event()
        _thread = threading.Thread(
            target=_loop, args=(app, _stop), name="backup-schedule", daemon=True,
        )
        _thread.start()
        return _thread


def stop_scheduler(timeout=5):
    """Asks the timer to stop. A dump already running is left to finish."""

    global _thread, _stop

    with _lock:
        thread, stop = _thread, _stop
        _thread, _stop = None, None

    if stop is not None:
        stop.set()
    if thread is not None:
        thread.join(timeout)
