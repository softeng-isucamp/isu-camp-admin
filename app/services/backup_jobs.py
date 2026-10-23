"""Database backups taken with pg_dump, and the jobs that run them.

A full dump of this project measures about 24 MB and takes a little over two
minutes through the Supabase pooler, which is why these are jobs rather than
responses: gunicorn is configured with ``--timeout 120``, so a synchronous dump
would be killed before it finished. The frontend already expects this shape -
``POST /api/backups`` hands back a queued job and the UI polls
``GET /api/jobs/<id>`` every 1.5 seconds until it is terminal.

The archive is pg_dump's custom format, so ``pg_restore`` can list it, restore
one table from it, or restore the lot. That is the whole reason for preferring
pg_dump over an application-level export: the file is restorable by standard
tooling with no code from this repository involved.

Job state lives in this module, like the OTP and rate-limit buckets in
``services.auth``, and for the same reason: the API runs a single worker (see
deploy/admin-api.Dockerfile). A second worker would need this moved into the
database or a shared cache.
"""

import json
import logging
import os
import secrets
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from extensions import db
from services.audit import log_audit

# Only the schema this application owns. Supabase keeps its own machinery in
# auth, storage and extensions schemas, which are not ours to dump or restore.
DUMP_SCHEMA = "public"

# Where pg_dump lives when it is not on PATH. The Windows paths are here
# because pgAdmin installs the client tools alongside itself, which is how a
# developer machine usually ends up with them.
_SEARCH_DIRECTORIES = (
    r"C:\Program Files\PostgreSQL\18\bin",
    r"C:\Program Files\PostgreSQL\17\bin",
    r"C:\Program Files\PostgreSQL\16\bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
    "/usr/bin",
)

JOB_KINDS = ("backup", "restore")

# ``cancelled`` is terminal like the other two, and distinct from ``failed`` on
# purpose: a cancelled operation is one somebody stopped, so it is not a fault
# to investigate and the panel does not dress it as one.
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")

# Generous but bounded: the measured full dump is about two minutes, so ten
# leaves room for a slow link without hanging for ever on a connection that
# will never answer.
RUN_TIMEOUT_SECONDS = 600

# How long a download link is good for. Short, because the link carries its own
# authority: it is a bearer token for a file that contains every administrator's
# password hash, and it has to survive only the moment between the dialog
# closing and the browser starting the transfer.
DOWNLOAD_LIFETIME_SECONDS = 180

# Where a download link lives. Root-relative, so it is resolved against the API
# base rather than the page origin - in development those are different hosts.
DOWNLOAD_PATH = "/api/backup-downloads"

# An archive is written under this name while pg_dump is still filling it, and
# only becomes a ``.dump`` once the tool has exited cleanly. list_backups()
# globs ``*.dump``, so an unfinished file is never offered as a backup.
WORKING_SUFFIX = ".partial"

logger = logging.getLogger(__name__)

_jobs = {}
_jobs_lock = threading.Lock()

# Issued download links, by token. Module-level for the same reason the jobs
# are: the API runs a single worker, so there is nowhere shared to put them
# yet, and a link that does not survive a restart is a link that cannot be
# replayed after one.
_downloads = {}
_downloads_lock = threading.Lock()


class BackupError(RuntimeError):
    """A backup operation that cannot proceed, with a status to answer with."""

    def __init__(self, message, status=500):
        super().__init__(message)
        self.status = status


# ==========================================
# Tooling and Storage
# ==========================================

def find_tool(name):
    """Locate a PostgreSQL client binary, or None.

    ``PG_DUMP_PATH`` and ``PG_RESTORE_PATH`` win, so a deployment can point at
    a specific version rather than whatever the image happens to ship.
    """

    override = os.getenv(f"{name.upper()}_PATH")
    if override:
        return override if Path(override).is_file() else None

    found = shutil.which(name)
    if found:
        return found

    for directory in _SEARCH_DIRECTORIES:
        for candidate in (Path(directory) / name, Path(directory) / f"{name}.exe"):
            if candidate.is_file():
                return str(candidate)

    return None


def require_tool(name):
    tool = find_tool(name)
    if tool is None:
        raise BackupError(
            f"{name} is not installed on the server, so backups cannot run. "
            f"Install the PostgreSQL client tools or set {name.upper()}_PATH.",
            status=503,
        )
    return tool


def backup_directory():
    """Where archives are kept, created on first use.

    Defaults to ``backups/`` beside the repository. In a container this must be
    a mounted volume or the archives disappear with the container - see the
    backup section of the README.
    """

    configured = os.getenv("BACKUP_DIR")
    if configured:
        directory = Path(configured)
    else:
        directory = Path(__file__).resolve().parents[2] / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _connection_environment():
    """pg_dump's connection, passed as environment rather than arguments.

    The password goes in PGPASSWORD specifically so it is not in the command
    line, where any other process on the host could read it.
    """

    url = os.getenv("SUPABASE_DATABASE_URL")
    if not url:
        raise BackupError("SUPABASE_DATABASE_URL is not configured.", status=503)

    parsed = urlsplit(url)
    if not parsed.hostname:
        raise BackupError("SUPABASE_DATABASE_URL is not a usable connection string.", status=503)

    environment = dict(os.environ)
    environment.update({
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGUSER": parsed.username or "postgres",
        "PGDATABASE": (parsed.path or "/postgres").lstrip("/") or "postgres",
        "PGPASSWORD": parsed.password or "",
        # Supabase requires TLS; being explicit means a client default cannot
        # quietly downgrade it.
        "PGSSLMODE": os.getenv("PGSSLMODE", "require"),
    })
    return environment


# ==========================================
# Archive Metadata
# ==========================================

def iso_utc(moment):
    """A timestamp in the Z-suffixed form the frontend's schema accepts.

    ``datetime.isoformat()`` writes a ``+00:00`` offset, and the Zod schema in
    services/profile.ts uses ``z.string().datetime()``, which rejects an offset
    unless it is asked to allow one. The two forms mean the same instant, so
    this is purely about agreeing on a spelling.
    """

    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalized_timestamp(value):
    """Re-spell a stored timestamp as Z-suffixed UTC, or None if unreadable.

    Applied on read as well as write, so archives written before this was
    fixed - and any sidecar edited by hand - still describe themselves in a
    form the frontend can parse.
    """

    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return iso_utc(moment)


def _metadata_path(archive):
    return archive.with_suffix(".json")


def _write_metadata(archive, **fields):
    _metadata_path(archive).write_text(json.dumps(fields, indent=2), encoding="utf-8")


def _read_metadata(archive):
    try:
        metadata = json.loads(_metadata_path(archive).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        metadata = {}

    # An archive whose sidecar is missing or unreadable is still a real file,
    # so describe what can be seen rather than hiding it. The file's own
    # modification time is the best available answer for when it was taken.
    created_at = _normalized_timestamp(metadata.get("createdAt"))
    if created_at is None:
        created_at = iso_utc(datetime.fromtimestamp(archive.stat().st_mtime, timezone.utc))

    return {
        "createdAt": created_at,
        "createdBy": metadata.get("createdBy") or "unknown",
        "scope": metadata.get("scope") or f"{DUMP_SCHEMA} schema",
        "status": metadata.get("status") or "ready",
    }


def list_backups():
    """Stored archives, newest first, in the shape the frontend parses."""

    items = []
    for archive in sorted(backup_directory().glob("*.dump"), reverse=True):
        metadata = _read_metadata(archive)
        items.append({
            "id": archive.stem,
            "createdAt": metadata["createdAt"],
            "createdBy": metadata["createdBy"],
            "sizeBytes": archive.stat().st_size,
            "scope": metadata["scope"],
            "status": metadata["status"],
        })
    items.sort(key=lambda item: item["createdAt"], reverse=True)
    return items


def find_archive(backup_id):
    """The archive for an id, or None. Rejects anything that is not a plain id."""

    # The id reaches here from the URL, so a path separator or traversal
    # segment must never be joined onto the backup directory.
    if not backup_id or "/" in backup_id or "\\" in backup_id or ".." in backup_id:
        return None
    archive = backup_directory() / f"{backup_id}.dump"
    return archive if archive.is_file() else None


def archive_status(backup_id):
    """What one archive's sidecar calls it, or None when there is no archive.

    Read rather than assumed, because a download is offered for a ``ready``
    archive only: the other statuses describe a file that is not a usable
    backup, and handing one over would look like a backup somebody could
    restore from.
    """

    archive = find_archive(backup_id)
    if archive is None:
        return None
    return _read_metadata(archive)["status"]


# ==========================================
# Housekeeping
# ==========================================

def sweep_unfinished():
    """Deletes what a dump that never finished left behind. Returns how many.

    A partial file is not an archive, but it still costs disk, and a process
    killed mid-dump is the one case where nothing cleans up after itself.
    """

    removed = 0
    for leftover in backup_directory().glob(f"*.dump{WORKING_SUFFIX}"):
        try:
            leftover.unlink()
        except OSError:
            logger.warning("Could not remove the unfinished archive %s", leftover.name)
            continue
        removed += 1
    return removed


def prune_archives(keep):
    """Keeps the newest ``keep`` archives, deletes the rest, returns their ids.

    Ordered by filename rather than by sidecar, because the name is the
    timestamp and a missing or hand-edited sidecar must not decide what gets
    deleted.

    Retention counts every archive in the directory, not only the automatic
    ones: a daily dump of this database is about 75 MB, so the directory grows
    by 2 GB a month whoever pressed the button.
    """

    keep = max(1, int(keep))
    archives = sorted(backup_directory().glob("*.dump"), reverse=True)

    removed = []
    for archive in archives[keep:]:
        try:
            archive.unlink()
        except OSError:
            logger.warning("Could not remove the expired archive %s", archive.name)
            continue
        try:
            _metadata_path(archive).unlink(missing_ok=True)
        except OSError:
            logger.warning("Removed %s but not its metadata", archive.name)
        removed.append(archive.stem)
    return removed


# ==========================================
# Jobs
# ==========================================

def _cancellable(job):
    """Whether a cancel sent right now would be honoured.

    False once the job is terminal, and false once it is past its point of no
    return - for a backup the moment the archive is published, for a restore
    the moment ``pg_restore`` commits its single transaction. The frontend
    hides the Cancel button when the key is absent, so saying so is how a
    window that cannot be stopped stops being offered.
    """

    return job["status"] not in TERMINAL_STATUSES and not job["committing"]


def _job_view(job):
    """The job as the API carries it. Never the process handle or the flags."""

    view = {"id": job["id"], "kind": job["kind"], "status": job["status"]}
    if job.get("message"):
        view["message"] = job["message"]
    if _cancellable(job):
        # Present only when true. A missing key hides the control, so an older
        # deployment that cannot cancel does not offer a button that would 404.
        view["cancellable"] = True
    return view


def _new_job(job_id, kind):
    return {
        "id": job_id,
        "kind": kind,
        "status": "queued",
        "message": None,
        # The running tool, so a cancel can stop it. Cleared once it has gone.
        "process": None,
        # Set by request_cancel and read by the worker, so a cancel that
        # arrives before the tool starts is honoured without starting it.
        "cancelling": False,
        # Set when the work can no longer be undone. See _cancellable.
        "committing": False,
        # Archive ids retention removed after this backup, for the caller that
        # waits on the job and describes what happened.
        "removed": [],
    }


def get_job(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return _job_view(job) if job else None


def job_retention(job_id):
    """Archive ids retention removed after this job's backup."""

    with _jobs_lock:
        job = _jobs.get(job_id)
        return list(job["removed"]) if job else []


def active_job():
    """The one unfinished job, if there is one.

    At most one runs at a time: two concurrent dumps would compete for the same
    connection budget, and a restore overlapping anything else is incoherent.
    """

    with _jobs_lock:
        for job in _jobs.values():
            if job["status"] not in TERMINAL_STATUSES:
                return _job_view(job)
    return None


def request_cancel(job_id):
    """Asks a running job to stop. Returns ``(view, accepted)``.

    ``view`` is None for a job nobody is tracking. ``accepted`` is False when
    there was nothing to cancel - the job has already finished, or it is past
    the point where stopping it would leave a mess - and the view then says so
    by omitting ``cancellable``, which is all the panel needs to stop offering
    the button.

    Accepting does not mean the job has stopped. The tool is asked to
    terminate and the job stays as it is, usually still ``running``, until the
    worker sees how it ended; the panel shows "Cancelling..." and keeps
    polling. Reporting ``cancelled`` here would be a guess, and ``pg_dump``
    that has already written its last byte is going to succeed.
    """

    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None, False
        if not _cancellable(job):
            return _job_view(job), False
        job["cancelling"] = True
        process = job["process"]
        view = _job_view(job)

    if process is not None:
        _stop(process)
    return view, True


def _stop(process):
    """Asks one client tool to stop, without waiting for it.

    A terminate is enough for both tools: ``pg_dump`` abandons its output and
    ``pg_restore`` abandons its transaction, which is exactly the outcome a
    cancel asks for. The worker is blocked reading the process, so it notices
    the moment it exits; if it does not exit at all, the run timeout kills it.
    """

    try:
        process.terminate()
    except Exception:
        logger.warning("Could not signal a cancelled operation to stop")


def _cancel_wanted(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return bool(job and job["cancelling"])


def _finish(job_id, status, message=None):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job:
            job["status"] = status
            job["message"] = message
            job["process"] = None


def _audit_in(app, actor, action, target_id, detail):
    """Writes one audit row from a worker thread. Best effort.

    A worker has no request and no application context, so it is given the app
    and takes one. Best effort by design: if the database is the thing that is
    broken then the attempt still belongs in the process log, and a failure to
    write history must not lose the archive the row was about.
    """

    if app is None:
        return

    try:
        with app.app_context():
            try:
                log_audit("System", actor, action, "Database", target_id, detail)
                db.session.commit()
            except Exception:
                db.session.rollback()
                raise
    except Exception:
        logger.exception("Could not record %s in the audit log", action)


def _run(job_id, command, environment, on_success=None, on_failure=None):
    """Runs one client tool to completion and records how it went.

    ``Popen`` rather than ``subprocess.run`` so the handle is reachable while
    the tool is working: a cancel is a terminate sent to that handle, and there
    is no way to send one to a call that does not return until the tool is
    done.

    ``on_failure`` is for whatever the tool left on disk. pg_dump creates its
    output file at once and fills it as it reads, so a dump that dies part way
    through - a dropped pooler connection, mid ``building_photo``, has happened
    here - has already written a truncated file. An automatic backup has nobody
    watching it, and a cancelled one has somebody watching who asked for it to
    go away, so clearing that up belongs with the run rather than with a caller
    who may never look.
    """

    def ended(status, message=None):
        if status != "succeeded" and on_failure:
            try:
                on_failure()
            except Exception:
                logger.exception("Could not clean up after a %s %s", status, command[0])
        _finish(job_id, status, message)

    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        # Cancelled while it was still queued: there is nothing to stop and
        # nothing to clean up, so the tool is never started.
        if job["cancelling"]:
            job["status"] = "cancelled"
            job["message"] = "Cancelled before it started."
            return
        job["status"] = "running"

    try:
        process = subprocess.Popen(
            command, env=environment, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
    except Exception as error:
        ended("failed", f"The operation could not be started: {error}")
        return

    # Published before the wait so a cancel has something to signal, and
    # re-read straight after in case one arrived between the two locks.
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["process"] = process
    if _cancel_wanted(job_id):
        _stop(process)

    try:
        _, errors = process.communicate(timeout=RUN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        ended("failed", "The operation timed out after 10 minutes.")
        return
    except Exception as error:
        ended("failed", f"The operation could not be completed: {error}")
        return

    if process.returncode == 0:
        # The real outcome, whoever asked for what. A cancel that arrived while
        # the tool was finishing lost the race, and reporting ``cancelled``
        # here would be a lie about an archive that now exists or a database
        # that has already been replaced.
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["committing"] = True
        if on_success:
            try:
                on_success()
            except Exception as error:
                # Through ``ended``, so a publish that failed before its rename
                # does not leave the partial file behind. Once the rename has
                # happened the discard is a no-op and the archive survives a
                # failure in the bookkeeping after it.
                ended("failed", f"The archive could not be recorded: {error}")
                return
        _finish(job_id, "succeeded")
        return

    if _cancel_wanted(job_id):
        ended("cancelled", "Cancelled before it finished.")
        return

    # The tool's own last line says far more than a generic failure, and it
    # does not contain the password, which was passed in the environment.
    detail = (errors or "").strip().splitlines()
    ended("failed", detail[-1][:300] if detail else "The operation failed.")


def _start(kind, worker):
    if kind not in JOB_KINDS:
        raise BackupError(f"Unknown job kind: {kind}")

    existing = active_job()
    if existing:
        raise BackupError("Another backup or restore is already running.", status=409)

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = _new_job(job_id, kind)
        view = _job_view(_jobs[job_id])

    thread = threading.Thread(target=worker, args=(job_id,), daemon=True)
    thread.start()
    return view


def start_backup(actor, keep=None, app=None):
    """Dumps the schema to a new archive in the background.

    ``keep`` applies retention once the archive is published, so the limit is
    enforced by "a backup completed" rather than by "the timer ran": a panel
    button fills the disk exactly as fast as the schedule does. It is read by
    the caller, which has a request and can reach the saved schedule; this
    thread has neither. None leaves retention alone.

    ``app`` lets the worker write the retention removals to the audit log, for
    the same reason: deleting somebody's archive is not something to do
    silently, and the deletion happens long after the caller has been answered.
    """

    tool = require_tool("pg_dump")
    environment = _connection_environment()
    directory = backup_directory()
    stamp = datetime.now(timezone.utc)
    archive = directory / f"{stamp.strftime('%Y%m%d-%H%M%S')}Z.dump"
    working = directory / f"{archive.name}{WORKING_SUFFIX}"

    command = [
        tool,
        f"--schema={DUMP_SCHEMA}",
        # Restorable into a database whose roles differ from this one's, which
        # is the normal case for a restore into a fresh Supabase project.
        "--no-owner",
        "--no-acl",
        "--format=custom",
        "--compress=6",
        "--file", str(working),
    ]

    def record(job_id):
        # The rename is what publishes the archive, and it is the last thing to
        # happen, so the panel never lists a dump that is still being written.
        working.replace(archive)
        _write_metadata(
            archive,
            createdAt=iso_utc(stamp),
            createdBy=actor,
            scope=f"{DUMP_SCHEMA} schema",
            status="ready",
        )

        if keep is None:
            return
        removed = prune_archives(keep)
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["removed"] = list(removed)
        for expired in removed:
            _audit_in(
                app, actor, "delete backup", expired,
                f"Retention removed archive {expired}, past the {keep} kept",
            )

    def discard():
        working.unlink(missing_ok=True)

    def worker(job_id):
        _run(job_id, command, environment,
             on_success=lambda: record(job_id), on_failure=discard)

    return _start("backup", worker)


def restore_enabled():
    """Whether restoring is switched on for this deployment.

    Off unless explicitly enabled. A restore overwrites the live database that
    the User App also reads, so it is not something a deployment should be able
    to do by default - or by a misclick.
    """

    return os.getenv("BACKUP_RESTORE_ENABLED", "").strip().lower() in ("1", "true", "yes")


def start_restore(backup_id, actor):
    """Restores an archive over the live schema. Destructive, and opt-in.

    ``--single-transaction`` is what makes this cancellable: terminating
    ``pg_restore`` part way through abandons the transaction, so the database
    is left exactly as it was rather than half replaced. The point of no return
    is that transaction's commit, which is the last thing the tool does.
    """

    if not restore_enabled():
        raise BackupError(
            "Restoring is disabled on this server. It replaces the live "
            "database, so it must be enabled deliberately with "
            "BACKUP_RESTORE_ENABLED=true.",
            status=403,
        )

    archive = find_archive(backup_id)
    if archive is None:
        raise BackupError("That backup is no longer available.", status=404)

    tool = require_tool("pg_restore")
    environment = _connection_environment()

    command = [
        tool,
        f"--schema={DUMP_SCHEMA}",
        "--no-owner",
        "--no-acl",
        # Replaces what is there rather than erroring on every existing object.
        "--clean",
        "--if-exists",
        "--single-transaction",
        "--dbname", environment["PGDATABASE"],
        str(archive),
    ]

    def worker(job_id):
        _run(job_id, command, environment)

    return _start("restore", worker)


# ==========================================
# Download Links
# ==========================================

# An archive is a complete copy of the database, including every
# administrator's password hash, so a link to one is credential material. Three
# things keep it from being a standing URL anybody can reuse: the token is
# unguessable, it is spent on first use, and it expires in minutes. The cookie
# is deliberately not part of it - a download goes through the browser's own
# downloader, and relying on the session would make the file reachable by any
# page that could persuade the browser to follow a link.


def issue_download(backup_id):
    """A one-time token for an archive, and when it stops working.

    Returns ``(token, expires_at)``. The archive is looked up now rather than
    at download time so a token is never issued for a file that is not there.
    """

    archive = find_archive(backup_id)
    if archive is None:
        raise BackupError("That backup is no longer available.", status=404)

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=DOWNLOAD_LIFETIME_SECONDS)

    with _downloads_lock:
        _sweep_downloads()
        _downloads[token] = {"backup_id": backup_id, "expires_at": expires_at}

    return token, expires_at


def claim_download(token):
    """The archive a token names, taken out of the store. None if it is no good.

    Spent before the file is streamed, not after, so a link cannot be used
    twice even by two requests arriving together. A transfer that then fails
    costs a new link rather than leaving a working one behind.
    """

    with _downloads_lock:
        _sweep_downloads()
        issued = _downloads.pop(token, None)

    if issued is None:
        return None
    if datetime.now(timezone.utc) >= issued["expires_at"]:
        return None
    return find_archive(issued["backup_id"])


def _sweep_downloads():
    """Drops expired tokens; the caller holds ``_downloads_lock``."""

    now = datetime.now(timezone.utc)
    for token in [key for key, issued in _downloads.items() if issued["expires_at"] <= now]:
        _downloads.pop(token, None)


def forget_downloads(backup_id):
    """Invalidates every link to one archive, for when it is deleted.

    A token outliving its file would answer 404 anyway, but a token that can
    never work should not be sitting in the store waiting to be swept.
    """

    with _downloads_lock:
        for token in [
            key for key, issued in _downloads.items() if issued["backup_id"] == backup_id
        ]:
            _downloads.pop(token, None)


def delete_archive(backup_id):
    """Removes one archive and its sidecar. True if the archive is now gone.

    The sidecar is best effort: an archive whose file is deleted is deleted,
    and a stray ``.json`` describes nothing, where a ``.dump`` left behind
    would still be listed as a backup.
    """

    archive = find_archive(backup_id)
    if archive is None:
        return False

    try:
        archive.unlink()
    except OSError:
        logger.warning("Could not remove the archive %s", archive.name)
        return False

    try:
        _metadata_path(archive).unlink(missing_ok=True)
    except OSError:
        logger.warning("Removed %s but not its metadata", archive.name)

    forget_downloads(backup_id)
    return True
