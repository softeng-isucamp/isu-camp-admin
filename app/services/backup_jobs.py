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
import os
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

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
TERMINAL_STATUSES = ("succeeded", "failed")

_jobs = {}
_jobs_lock = threading.Lock()


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


# ==========================================
# Jobs
# ==========================================

def _job_view(job):
    view = {"id": job["id"], "kind": job["kind"], "status": job["status"]}
    if job.get("message"):
        view["message"] = job["message"]
    return view


def get_job(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return _job_view(job) if job else None


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


def _finish(job_id, status, message=None):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job:
            job["status"] = status
            job["message"] = message


def _run(job_id, command, environment, on_success=None):
    """Runs one client tool to completion and records how it went."""

    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]["status"] = "running"

    try:
        completed = subprocess.run(
            command, env=environment, capture_output=True, text=True,
            # Generous but bounded: the measured full dump is about two
            # minutes, so ten leaves room for a slow link without hanging for
            # ever on a connection that will never answer.
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        _finish(job_id, "failed", "The operation timed out after 10 minutes.")
        return
    except Exception as error:
        _finish(job_id, "failed", f"The operation could not be started: {error}")
        return

    if completed.returncode != 0:
        # The tool's own last line says far more than a generic failure, and it
        # does not contain the password, which was passed in the environment.
        detail = (completed.stderr or "").strip().splitlines()
        _finish(job_id, "failed", detail[-1][:300] if detail else "The operation failed.")
        return

    if on_success:
        try:
            on_success()
        except Exception as error:
            _finish(job_id, "failed", f"The archive could not be recorded: {error}")
            return

    _finish(job_id, "succeeded")


def _start(kind, worker):
    if kind not in JOB_KINDS:
        raise BackupError(f"Unknown job kind: {kind}")

    existing = active_job()
    if existing:
        raise BackupError("Another backup or restore is already running.", status=409)

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "message": None}

    thread = threading.Thread(target=worker, args=(job_id,), daemon=True)
    thread.start()
    return _job_view({"id": job_id, "kind": kind, "status": "queued"})


# How many archives to keep. At roughly 24 MB a dump, a nightly schedule is
# about 730 MB a month, so something has to age them out.
DEFAULT_KEEP = 14


def _backup_plan(actor):
    """The command, environment and completion step for one dump.

    Shared by the background job and the scheduled run so the two cannot drift
    into producing different archives.
    """

    tool = require_tool("pg_dump")
    environment = _connection_environment()
    directory = backup_directory()
    stamp = datetime.now(timezone.utc)
    archive = directory / f"{stamp.strftime('%Y%m%d-%H%M%S')}Z.dump"

    # pg_dump writes to a .partial name and the file is renamed only once it
    # exits cleanly. list_backups globs *.dump, so a dump interrupted by a
    # crash or a restart leaves a .partial that is never offered for restore -
    # previously it left a truncated archive that listed as ready and failed
    # only when someone tried to use it.
    partial = archive.with_suffix(".dump.partial")

    command = [
        tool,
        f"--schema={DUMP_SCHEMA}",
        # Restorable into a database whose roles differ from this one's, which
        # is the normal case for a restore into a fresh Supabase project.
        "--no-owner",
        "--no-acl",
        "--format=custom",
        "--compress=6",
        "--file", str(partial),
    ]

    def record():
        partial.replace(archive)
        _write_metadata(
            archive,
            createdAt=iso_utc(stamp),
            createdBy=actor,
            scope=f"{DUMP_SCHEMA} schema",
            status="ready",
        )

    return command, environment, archive, record


def prune_backups(keep=None):
    """Delete all but the newest ``keep`` archives. Returns the ids removed.

    Archives are named by UTC timestamp, so newest-first is their reverse
    filename order; no metadata has to be read to decide what goes.
    """

    if keep is None:
        keep = int(os.getenv("BACKUP_KEEP", DEFAULT_KEEP))
    if keep < 1:
        # Refusing is safer than honouring a mistake that deletes everything.
        raise BackupError("BACKUP_KEEP must be at least 1.")

    archives = sorted(backup_directory().glob("*.dump"), reverse=True)
    removed = []
    for archive in archives[keep:]:
        metadata = _metadata_path(archive)
        archive.unlink(missing_ok=True)
        metadata.unlink(missing_ok=True)
        removed.append(archive.stem)
    return removed


def clear_partial_archives():
    """Remove leftovers from dumps that never finished. Returns the names."""

    removed = []
    for partial in backup_directory().glob("*.dump.partial"):
        partial.unlink(missing_ok=True)
        removed.append(partial.name)
    return removed


def run_backup(actor):
    """Takes one backup and waits for it. Used by the scheduled run.

    Synchronous on purpose: a scheduler wants an exit code, not a job to poll,
    and there is no request waiting on it to time out.
    """

    command, environment, archive, record = _backup_plan(actor)

    try:
        completed = subprocess.run(
            command, env=environment, capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise BackupError("The backup timed out after 10 minutes.")

    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()
        raise BackupError(detail[-1][:300] if detail else "pg_dump failed.")

    record()
    return {"id": archive.stem, "sizeBytes": archive.stat().st_size}


def start_backup(actor):
    """Dumps the schema to a new archive in the background."""

    command, environment, _archive, record = _backup_plan(actor)

    def worker(job_id):
        _run(job_id, command, environment, on_success=record)

    return _start("backup", worker)


def restore_enabled():
    """Whether restoring is switched on for this deployment.

    Off unless explicitly enabled. A restore overwrites the live database that
    the User App also reads, so it is not something a deployment should be able
    to do by default - or by a misclick.
    """

    return os.getenv("BACKUP_RESTORE_ENABLED", "").strip().lower() in ("1", "true", "yes")


def start_restore(backup_id, actor):
    """Restores an archive over the live schema. Destructive, and opt-in."""

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
