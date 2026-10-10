"""Superadmin backup and restore, backing the Backup & Recovery panel.

The panel shipped against a fixture, so these four routes returned 404 - and a
preflight must be 2xx, which is why the browser called a missing route a CORS
policy failure.

``/api/jobs/<id>`` is not under ``/api/backups`` because the frontend polls it
at the top level, so this blueprint is mounted at ``/api`` and names both
paths itself.

The panel is hidden from anyone who is not a superadmin, but the gate is
enforced here as well: the UI deciding what to show is a convenience, and a
route that trusts it is not access control.
"""

import logging

from flask import Blueprint, jsonify, request

from auth import admin_required, rate_limited
from extensions import db
from services.audit import log_audit
from services.backup_jobs import (
    BackupError,
    active_job,
    find_archive,
    get_job,
    list_backups,
    restore_enabled,
    start_backup,
    start_restore,
)
from services.security import verify_password

backups_bp = Blueprint("backups", __name__, url_prefix="/api")
logger = logging.getLogger(__name__)


def _error(message, status=400):
    return jsonify({"success": False, "message": message}), status


def _superadmin_required():
    """``(admin, None)`` for a signed-in superadmin, else an error response."""

    admin, error = admin_required()
    if error:
        return None, error

    if not admin.is_superadmin:
        # Deliberately not 404: the caller is a real administrator, and telling
        # them this needs a higher role is more useful than pretending the
        # feature does not exist.
        return None, _error(
            "Backup and restore is limited to superadministrators.", status=403
        )

    return admin, None


@backups_bp.get("/backups")
def list_backup_history():
    """Stored archives plus whichever job is still running."""

    _, error = _superadmin_required()
    if error:
        return error

    try:
        return jsonify({"items": list_backups(), "activeJob": active_job()}), 200
    except BackupError as failure:
        return _error(str(failure), failure.status)
    except Exception:
        logger.exception("Failed to list backups")
        return _error("The backup history could not be read.", status=500)


@backups_bp.post("/backups")
def create_backup():
    """Starts a pg_dump in the background and returns the job to poll."""

    admin, error = _superadmin_required()
    if error:
        return error

    # A dump costs minutes of server time and a connection slot, so a repeated
    # click cannot queue another. start_backup also refuses a second concurrent
    # job; this is the cheaper refusal.
    limited = rate_limited(
        "backup-create",
        str(admin.id),
        3,
        "A backup was just requested. Please wait before starting another.",
    )
    if limited:
        return limited

    try:
        job = start_backup(actor=admin.username)
    except BackupError as failure:
        return _error(str(failure), failure.status)
    except Exception:
        logger.exception("Failed to start a backup")
        return _error("The backup could not be started.", status=500)

    log_audit("Admin", admin, "start backup", "Database", None,
              f"Started backup job {job['id']}")
    db.session.commit()
    return jsonify(job), 202


@backups_bp.post("/backups/<backup_id>/restore")
def restore_backup(backup_id):
    """Restores an archive over the live schema, after re-authentication.

    Destructive and off by default. The password is required even though the
    session proves who is calling, for the same reason a delete asks: this
    replaces data the whole team and the User App read.
    """

    admin, error = _superadmin_required()
    if error:
        return error

    limited = rate_limited(
        "backup-restore",
        str(admin.id),
        3,
        "Too many restore attempts. Please wait before trying again.",
    )
    if limited:
        return limited

    data = request.get_json(silent=True)
    password = str((data or {}).get("currentPassword") or "") if isinstance(data, dict) else ""
    if not password:
        return _error("Your current password is required to restore.")

    matches, _ = verify_password(admin.password, password)
    if not matches:
        log_audit("Admin", admin, "restore refused", "Database", None,
                  f"Incorrect password entered for a restore of {backup_id}")
        db.session.commit()
        return _error("Your current password is incorrect", status=401)

    if not restore_enabled():
        # Answered after the password check so this cannot be used to probe
        # whether restoring is available without proving who you are.
        return _error(
            "Restoring is disabled on this server. It replaces the live "
            "database, so it must be enabled deliberately with "
            "BACKUP_RESTORE_ENABLED=true.",
            status=403,
        )

    if find_archive(backup_id) is None:
        return _error("That backup is no longer available.", status=404)

    try:
        job = start_restore(backup_id, actor=admin.username)
    except BackupError as failure:
        return _error(str(failure), failure.status)
    except Exception:
        logger.exception("Failed to start a restore")
        return _error("The restore could not be started.", status=500)

    log_audit("Admin", admin, "start restore", "Database", None,
              f"Started restore of {backup_id} as job {job['id']}")
    db.session.commit()
    return jsonify(job), 202


@backups_bp.get("/jobs/<job_id>")
def read_job(job_id):
    """The state of one backup or restore, polled by the panel until terminal."""

    _, error = _superadmin_required()
    if error:
        return error

    job = get_job(job_id)
    if job is None:
        # Jobs live in memory, so a restart forgets them. Saying so is more
        # useful than a bare not-found, because the operation may well have
        # finished and written its archive.
        return _error(
            "That operation is no longer being tracked. The server may have "
            "restarted; check the backup list.",
            status=404,
        )

    return jsonify(job), 200
