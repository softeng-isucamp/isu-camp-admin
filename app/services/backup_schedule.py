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
  has already been taken - unless the claim has no archive behind it, in which
  case its owner died or failed and the night is up for grabs again.

What it reads is a database row, not the environment: Backup & Recovery offers
the schedule as a form, so the thread re-reads
``public.backup_schedule`` on every pass and a saved change takes effect
without a restart. ``BACKUP_SCHEDULE_ENABLED``, ``BACKUP_SCHEDULE_AT`` and
``BACKUP_KEEP`` seed that row the first time it is read and are ignored
afterwards.

The thread therefore starts whether or not the schedule is currently on: being
off is a value in the row, and a thread that only started when the row said
"on" could never see it change to "on". A deployment still cannot run this
usefully until it has ``pg_dump`` and a mounted ``backups/`` volume - without
them every night fails with a 503 that lands in the audit log. See the backup
section of the README.
"""

import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from extensions import db
from model.backup_schedule import ROW_ID, BackupSchedule
from services.audit import log_audit
from services.backup_jobs import (
    RUN_TIMEOUT_SECONDS,
    TERMINAL_STATUSES,
    BackupError,
    backup_directory,
    get_job,
    iso_utc,
    job_retention,
    list_backups,
    start_backup,
)

# The campus is in one place, so the schedule runs on one clock. Stored on the
# row as well as named here, because the saved schedule the API returns has to
# be able to say which zone its time of day is in.
TIME_ZONE = "Asia/Manila"

# What ``BACKUP_SCHEDULE_AT`` meant before the schedule moved into the
# database: a UTC time of day. 18:30 UTC is 02:30 in Philippine time, which is
# the quiet hour for a campus system, and it is the seed the saved schedule
# starts from.
DEFAULT_AT_UTC = "18:30"

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

# How long a claim is respected with nothing to show for it: the longest a dump
# may run, plus time to publish it. Past that, its owner is not coming back.
CLAIM_GRACE = timedelta(seconds=RUN_TIMEOUT_SECONDS + 300)

logger = logging.getLogger(__name__)

_thread = None
_stop = None
_lock = threading.Lock()


# ==========================================
# Settings
# ==========================================

# The schedule lives in one database row, read on every pass of the timer, so a
# change saved through PUT /api/backups/schedule takes effect without anybody
# restarting the API. The three environment variables below seed that row the
# first time it is read and are ignored afterwards: they were the whole
# schedule before the panel offered a form, and a deployment that already runs
# a nightly dump keeps the one it has.


def schedule_zone():
    """The zone a schedule's time of day is written in.

    ``ZoneInfo`` needs a tz database, and Windows ships none - a developer
    machine without the ``tzdata`` package cannot look "Asia/Manila" up at all.
    The fallback is exact rather than approximate: Philippine time has been a
    flat UTC+8 with no daylight saving since 1978, so a fixed offset and the
    named zone agree on every timestamp this schedule can produce.
    """

    try:
        return ZoneInfo(TIME_ZONE)
    except Exception:
        return timezone(timedelta(hours=8), TIME_ZONE)


def _default_time():
    """The seed for ``at_time``, converted from the old UTC environment variable.

    ``BACKUP_SCHEDULE_AT`` named a UTC time of day and the column holds a local
    one, so the digits are not interchangeable: copying 18:30 across would move
    an existing deployment's nightly dump from half past two in the morning to
    half past two in the afternoon.
    """

    raw = (os.getenv("BACKUP_SCHEDULE_AT") or "").strip() or DEFAULT_AT_UTC
    try:
        hours, _, minutes = raw.partition(":")
        hour, minute = int(hours), int(minutes)
        if not (0 <= hour < 24 and 0 <= minute < 60):
            raise ValueError(raw)
    except ValueError:
        logger.warning(
            "BACKUP_SCHEDULE_AT is not a 24-hour HH:MM time (%r); using %s UTC",
            raw, DEFAULT_AT_UTC,
        )
        hour, minute = (int(part) for part in DEFAULT_AT_UTC.split(":"))

    # Any date will do: the offset is fixed, so the wall clock lands the same
    # way whichever day it is converted on.
    utc = datetime(2000, 1, 1, hour, minute, tzinfo=timezone.utc)
    return utc.astimezone(schedule_zone()).strftime("%H:%M")


def _default_keep():
    raw = (os.getenv("BACKUP_KEEP") or "").strip()
    if not raw:
        return DEFAULT_KEEP
    try:
        return max(1, int(raw))
    except ValueError:
        logger.warning("BACKUP_KEEP is not a number (%r); keeping %d", raw, DEFAULT_KEEP)
        return DEFAULT_KEEP


def schedule_enabled():
    """Whether a deployment is allowed to seed the schedule as switched on."""

    return os.getenv("BACKUP_SCHEDULE_ENABLED", "").strip().lower() in ("1", "true", "yes")


def _seed():
    return BackupSchedule(
        id=ROW_ID,
        enabled=schedule_enabled(),
        frequency="daily",
        day_of_week=None,
        at_time=_default_time(),
        time_zone=TIME_ZONE,
        keep=_default_keep(),
    )


def schedule_row(create=True):
    """The one schedule row, seeded from the environment on first read.

    Returns None when the table cannot be read at all, which is how a
    deployment that has not applied the migration yet behaves: GET /api/backups
    then leaves the ``schedule`` key out and the panel hides the control rather
    than offering a form that cannot save. The caller holds an app context.
    """

    try:
        row = db.session.get(BackupSchedule, ROW_ID)
    except Exception:
        db.session.rollback()
        logger.warning("The backup schedule could not be read", exc_info=True)
        return None

    if row is not None or not create:
        return row

    try:
        row = _seed()
        db.session.add(row)
        db.session.commit()
        return row
    except Exception:
        # Another process may have seeded it in the meantime, which is a race
        # worth losing: read theirs rather than insisting on ours.
        db.session.rollback()
        try:
            return db.session.get(BackupSchedule, ROW_ID)
        except Exception:
            db.session.rollback()
            logger.warning("The backup schedule could not be seeded", exc_info=True)
            return None


def read_schedule():
    """The saved schedule as the API carries it, or None if it cannot be read."""

    row = schedule_row()
    return row.to_dict() if row is not None else None


# ==========================================
# Validating a Saved Schedule
# ==========================================

FREQUENCIES = ("daily", "weekly")
TIME_PATTERN = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")


def validate_schedule(payload):
    """Checks a submitted schedule. Returns ``(values, errors)``.

    ``errors`` is ``{field: message}`` and empty when the schedule is usable;
    the route answers 422 with it. Every field is checked rather than stopping
    at the first, because the schedule is one form and the caller should not
    have to submit four times to learn about four mistakes.
    """

    errors = {}
    if not isinstance(payload, dict):
        return None, {"schedule": "A schedule is required."}

    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        errors["enabled"] = "Say whether the automatic backup is on or off."

    frequency = payload.get("frequency")
    if frequency not in FREQUENCIES:
        errors["frequency"] = "Frequency must be daily or weekly."

    day = payload.get("day")
    if frequency == "weekly":
        # A bool is an int in Python, and True would arrive here as Monday.
        if isinstance(day, bool) or not isinstance(day, int) or not 0 <= day <= 6:
            errors["day"] = "Choose a day of the week."
    else:
        day = None

    at_time = payload.get("time")
    if not isinstance(at_time, str) or not TIME_PATTERN.match(at_time.strip()):
        errors["time"] = "Enter a time as HH:MM on a 24-hour clock."
    else:
        at_time = at_time.strip()

    zone = payload.get("timeZone")
    if zone is not None and str(zone).strip() != TIME_ZONE:
        # One zone, because the campus is in one place. Accepting another would
        # mean storing a schedule this server cannot resolve, and silently
        # rewriting it would be worse than refusing it.
        errors["timeZone"] = f"The schedule runs in {TIME_ZONE}."

    keep = payload.get("keep")
    if isinstance(keep, bool) or not isinstance(keep, int) or keep < 1:
        errors["keep"] = "Keep at least one backup."

    if errors:
        return None, errors

    return {
        "enabled": enabled,
        "frequency": frequency,
        "day_of_week": day,
        "at_time": at_time,
        "time_zone": TIME_ZONE,
        "keep": keep,
    }, {}


def save_schedule(values):
    """Writes a validated schedule and returns ``(saved, before)``.

    ``before`` is the one-line description of what was there, so the caller can
    audit the change as old -> new. The row is created if the table has never
    been seeded, so the first save is not a special case.
    """

    row = schedule_row()
    if row is None:
        row = _seed()
        db.session.add(row)

    before = row.describe()
    for field, value in values.items():
        setattr(row, field, value)
    db.session.flush()
    return row, before


# ==========================================
# When the Next Run Is Due
# ==========================================

def next_run_after(moment, schedule=None):
    """The next time a backup is due, strictly after ``moment``, in UTC.

    The schedule's time of day is local, so the arithmetic is done in the
    schedule's zone and converted back: asking for 02:30 means 02:30 on a
    Manila clock, not a fixed number of hours after midnight UTC.

    ``schedule`` is the dict ``read_schedule`` returns. Without one the caller
    has no saved schedule to work from, so the seed defaults answer - which is
    what the timer uses to decide how long to sleep before looking again.
    """

    schedule = schedule or {"frequency": "daily", "day": None, "time": _default_time()}
    hour, minute = (int(part) for part in str(schedule["time"]).split(":"))

    zone = schedule_zone()
    local = moment.astimezone(zone)
    due = local.replace(hour=hour, minute=minute, second=0, microsecond=0)

    if schedule.get("frequency") == "weekly" and schedule.get("day") is not None:
        # isoweekday() is Monday 1 through Sunday 7; the API counts Sunday as 0.
        today = local.isoweekday() % 7
        due += timedelta(days=(int(schedule["day"]) - today) % 7)
        if due <= local:
            due += timedelta(days=7)
    elif due <= local:
        due += timedelta(days=1)

    return due.astimezone(timezone.utc)


# ==========================================
# Claiming a Run
# ==========================================

def _claim_path(due):
    return backup_directory() / f".claimed-{due.strftime('%Y%m%d-%H%M')}Z"


def _abandoned(marker):
    """Whether a claim was made by a run that never produced an archive.

    A claim means "somebody is taking this night", and the claim outlives its
    owner, so a process killed mid-dump - or a dump that failed - would
    otherwise own the night for ever: every restart finds the marker and
    skips it, and nothing is ever taken. The owner is given as long as a dump
    may run, and after that a claim with no archive taken since it was made
    is not a night in progress.
    """

    try:
        claimed = datetime.fromtimestamp(marker.stat().st_mtime, timezone.utc)
    except OSError:
        return False

    if datetime.now(timezone.utc) - claimed < CLAIM_GRACE:
        return False

    taken = _newest_archive_taken()
    return taken is None or taken < claimed


def claim(due):
    """Takes the run due at ``due`` for this process, or returns False.

    ``O_EXCL`` is the whole mechanism: creating the marker either succeeds, in
    which case this process owns that night, or it fails because another
    process - or this one before a restart - already owns it. An owner that
    left no archive behind (see ``_abandoned``) loses the night to the next
    caller.
    """

    marker = _claim_path(due)
    for taking_over in (False, True):
        try:
            handle = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if taking_over or not _abandoned(marker):
                return False
            logger.warning(
                "The %s run was claimed but left no archive; taking it over",
                iso_utc(due),
            )
            try:
                marker.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                return False
            continue
        except OSError:
            # Without a writable directory there is nowhere to put the archive
            # either, so let the run proceed and fail where the reason is clear.
            logger.warning("Could not record a claim for the %s run", iso_utc(due))
            return True
        break

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

def _newest_archive_taken():
    """When the newest archive was taken, or None if there is none."""

    items = list_backups()
    if not items:
        return None

    try:
        taken = datetime.fromisoformat(str(items[0]["createdAt"]).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if taken.tzinfo is None:
        taken = taken.replace(tzinfo=timezone.utc)
    return taken


def _age_of_newest_archive():
    """How long since the newest archive was taken, or None if there is none."""

    taken = _newest_archive_taken()
    return None if taken is None else datetime.now(timezone.utc) - taken


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


def run_backup_now(app=None, keep=None):
    """Takes one automatic backup, applies retention, and records the outcome.

    Returns the finished job, or None if it never started. Raises nothing: this
    runs on a thread with nobody to report an exception to.

    ``keep`` comes from the saved schedule the caller has already read.
    Retention itself runs inside the job, right after the archive is published,
    so a backup somebody started from the panel is held to the same limit as
    one this module started - the disk does not care who pressed the button.
    """

    # Leftover .partial files are swept by start_backup once it is admitted,
    # never here: while another job runs, a .partial is that job's live file.
    if keep is None:
        keep = _default_keep()

    try:
        job = start_backup(ACTOR, keep=keep, app=app)
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

    # Retention already ran inside the job; this is only what it removed, so
    # the one row describing the night says so too.
    expired = job_retention(job["id"])
    _forget_old_claims()

    stored = list_backups()
    archive_id = stored[0]["id"] if stored else None
    detail = f"Automatic backup {archive_id} completed"
    if expired:
        detail += f"; removed {len(expired)} archive(s) past the {keep} kept"

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


def current_schedule(app):
    """The saved schedule, read from inside an application context.

    None when there is no app to read with or the row cannot be read, which the
    timer treats as "nothing to do": a schedule it cannot see is not a schedule
    it should guess at.
    """

    if app is None:
        return None
    try:
        with app.app_context():
            return read_schedule()
    except Exception:
        logger.exception("The backup schedule could not be read")
        return None


def _loop(app, stop):
    schedule = current_schedule(app)

    if (
        schedule
        and schedule["enabled"]
        and is_overdue()
        and not _sleep(stop, CATCHUP_DELAY_SECONDS)
    ):
        # The night that has just gone by, which is the one that was missed.
        missed = next_run_after(datetime.now(timezone.utc), schedule) - timedelta(days=1)
        if claim(missed):
            logger.info("No backup in the last day; taking one now")
            run_backup_now(app, keep=schedule["keep"])

    # The run being waited for. Remembered between passes rather than worked
    # out again each time: ``next_run_after`` answers "strictly after now", so
    # once the sleep has carried the clock to the due minute, asking again
    # names tomorrow and the run that was just reached is never taken.
    pending = None
    announced = None

    while not stop.is_set():
        # Re-read on every pass, so saving a schedule takes effect without a
        # restart: a change to the time moves the next run, and switching the
        # schedule off stops it taking one, with nothing to redeploy.
        schedule = current_schedule(app)

        if not schedule:
            # Unreadable, which is usually the database being briefly away. The
            # run being waited for stays waited for, so a night that comes due
            # during an outage is taken when it ends rather than lost.
            if _sleep(stop, SLEEP_SLICE_SECONDS):
                return
            continue

        if not schedule["enabled"]:
            pending = announced = None
            if _sleep(stop, SLEEP_SLICE_SECONDS):
                return
            continue

        now = datetime.now(timezone.utc)
        if pending is None or pending > now:
            # Still ahead, so a saved change to the time is allowed to move it.
            pending = next_run_after(now, schedule)
        if pending != announced:
            # Only when it moves, because this runs every minute and a log line
            # a minute saying the same thing is a log nobody reads.
            logger.info("The next automatic backup is due at %s", iso_utc(pending))
            announced = pending

        remaining = (pending - now).total_seconds()
        if remaining > 0:
            if _sleep(stop, min(remaining, SLEEP_SLICE_SECONDS)):
                return
            continue

        due, pending = pending, None
        try:
            if claim(due):
                run_backup_now(app, keep=schedule["keep"])
            else:
                logger.info("The %s run was already taken", iso_utc(due))
        except Exception:
            # The timer is the only thing that makes automatic backups, so it
            # outlives any one failed night.
            logger.exception("The automatic backup at %s ended badly", iso_utc(due))


def _show_progress_in_the_log():
    """Lets this module's INFO lines reach the process log under gunicorn.

    Nothing configures logging here, so the root logger drops everything below
    WARNING and the only trace of a night was its failure. The lines that say
    when the next run is due, and that a run was taken or skipped, are the ones
    that explain a missing backup. Left alone wherever something has already
    set logging up - a test run, or a deployment with its own configuration.
    """

    if logging.getLogger().handlers:
        return

    services = logging.getLogger("services")
    if services.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(name)s: %(message)s"))
    services.addHandler(handler)
    services.setLevel(logging.INFO)


def start_scheduler(app=None):
    """Starts the timer. Returns the thread, or None when it cannot run.

    Started whether or not the schedule is currently on, because being off is a
    value in the row and a thread that only started when the row said "on"
    could never see it change to "on". The timer reads the row on every pass
    and does nothing on the passes where it is off.

    ``app`` is how the thread reaches the row and the audit log, so without one
    there is nothing for it to read and no timer is started.
    """

    global _thread, _stop

    _show_progress_in_the_log()

    if app is None:
        logger.info("Automatic backups need an application to read their schedule")
        return None

    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread

        schedule = current_schedule(app)
        if schedule is None:
            logger.warning(
                "The backup schedule could not be read, so automatic backups are "
                "off. Apply migrations/20261023_add_backup_schedule.sql."
            )
        elif schedule["enabled"]:
            logger.info(
                "Automatic backups are on: %s at %s %s, keeping %d",
                schedule["frequency"], schedule["time"], schedule["timeZone"],
                schedule["keep"],
            )
        else:
            logger.info("Automatic backups are off; the timer is watching for a change")

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
