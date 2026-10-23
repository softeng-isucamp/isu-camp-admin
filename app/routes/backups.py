"""Superadmin backup and restore, backing the Backup & Recovery panel.

The panel shipped against a fixture, so these routes returned 404 - and a
preflight must be 2xx, which is why the browser called a missing route a CORS
policy failure.

``/api/jobs/<id>`` and ``/api/backup-downloads/<token>`` are not under
``/api/backups`` because the frontend polls the first at the top level and the
browser fetches the second by a URL this module hands out, so this blueprint is
mounted at ``/api`` and names each path itself.

Every control the panel offers is advertised rather than assumed: ``GET
/api/backups`` carries ``canDownload``, ``canDelete`` and ``schedule``, a job
carries ``cancellable``, and a key that is missing hides its control. That is
what lets this land in pieces - a frontend talking to a deployment that has
only half of it offers only the half that works, instead of offering a button
that 404s.

The panel is hidden from anyone who is not a superadmin, but the gate is
enforced here as well: the UI deciding what to show is a convenience, and a
route that trusts it is not access control. The one exception is the download
link, which is authorised by its own one-time token because the browser's
downloader fetches it - see services/backup_jobs.py.
"""

import logging

from flask import Blueprint, current_app, jsonify, request, send_file

from auth import admin_required, rate_limited, reauth_required
from extensions import db
from services.audit import log_audit
from services.backup_jobs import (
    BackupError,
    active_job,
    archive_status,
    claim_download,
    delete_archive,
    find_archive,
    get_job,
    issue_download,
    iso_utc,
    list_backups,
    request_cancel,
    restore_enabled,
    start_backup,
    start_restore,
    DOWNLOAD_PATH,
)
from services.backup_schedule import read_schedule, save_schedule, validate_schedule
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


def _confirm_password(admin, data, message):
    """Re-checks the caller's password from a request body. None when it is right.

    Separate from ``reauth_required``, which reads a confirmation the session
    already holds. Restore and download ask in their own dialog and send the
    password with the request, so the password is checked here and never kept.
    """

    password = str((data or {}).get("currentPassword") or "") if isinstance(data, dict) else ""
    if not password:
        return _error(message)

    matches, _ = verify_password(admin.password, password)
    if not matches:
        return _error("Your current password is incorrect", status=401)
    return None


def _keep_from_schedule():
    """The retention limit a new backup is held to, or None if there is no row.

    Read here, in the request, because the thread that takes the dump has no
    application context to read it with. None leaves retention alone, so a
    deployment that has not applied the schedule migration keeps every archive
    rather than guessing at a limit and deleting somebody's backup.
    """

    schedule = read_schedule()
    return schedule["keep"] if schedule else None


@backups_bp.get("/backups")
def list_backup_history():
    """Stored archives, whichever job is still running, and what this server can do."""

    _, error = _superadmin_required()
    if error:
        return error

    try:
        payload = {
            "items": list_backups(),
            "activeJob": active_job(),
            # Both routes exist on this server, so both controls are offered.
            # Each still re-checks the role and the password for itself.
            "canDownload": True,
            "canDelete": True,
        }
    except BackupError as failure:
        return _error(str(failure), failure.status)
    except Exception:
        logger.exception("Failed to list backups")
        return _error("The backup history could not be read.", status=500)

    # Left out when it cannot be read - a deployment that has not applied the
    # schedule migration yet - so the panel hides the schedule button instead
    # of offering a form that could not save.
    schedule = read_schedule()
    if schedule is not None:
        payload["schedule"] = schedule

    return jsonify(payload), 200


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
        job = start_backup(
            actor=admin.username,
            keep=_keep_from_schedule(),
            # The worker writes its retention removals to the audit log long
            # after this request has been answered, so it is given the app.
            app=current_app._get_current_object(),
        )
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
    refused = _confirm_password(
        admin, data, "Your current password is required to restore.",
    )
    if refused:
        if refused[1] == 401:
            log_audit("Admin", admin, "restore refused", "Database", None,
                      f"Incorrect password entered for a restore of {backup_id}")
            db.session.commit()
        return refused

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


@backups_bp.post("/jobs/<job_id>/cancel")
def cancel_job(job_id):
    """Asks a running backup or restore to stop.

    Any superadmin may cancel any job, including one the schedule started:
    whoever is watching a dump compete with the thing they need the database
    for is the person who should be able to stop it, and an unattended run has
    nobody else to ask.

    202 means the tool has been told to stop, not that it has: the job comes
    back as it is, usually still ``running``, and the panel shows
    "Cancelling..." while it keeps polling. 200 means there was nothing to
    cancel - the job has already ended, or it is past the point where stopping
    it would leave the database half replaced - and the job then comes back
    without ``cancellable`` so the button goes away.
    """

    admin, error = _superadmin_required()
    if error:
        return error

    view, accepted = request_cancel(job_id)
    if view is None:
        return _error(
            "That operation is no longer being tracked. The server may have "
            "restarted; check the backup list.",
            status=404,
        )

    if not accepted:
        return jsonify(view), 200

    log_audit("System", admin, "cancel backup job", "Database", job_id,
              f"Cancelled the {view['kind']} job {job_id}")
    db.session.commit()
    return jsonify(view), 202


@backups_bp.post("/backups/<backup_id>/download")
def download_backup(backup_id):
    """Issues a one-time link to one archive, after re-checking the password.

    The archive is a complete copy of the database, including every
    administrator's password hash, so this is closer to exporting credentials
    than to saving a file. The password is asked for the same reason a restore
    asks, and the link it returns is unguessable, single-use and good for
    minutes - see services/backup_jobs.py.
    """

    admin, error = _superadmin_required()
    if error:
        return error

    limited = rate_limited(
        "backup-download",
        str(admin.id),
        5,
        "Too many download attempts. Please wait before trying again.",
    )
    if limited:
        return limited

    data = request.get_json(silent=True)
    refused = _confirm_password(
        admin, data, "Your current password is required to download a backup.",
    )
    if refused:
        if refused[1] == 401:
            log_audit("Admin", admin, "download refused", "Database", backup_id,
                      f"Incorrect password entered for a download of {backup_id}")
            db.session.commit()
        return refused

    # Checked after the password, so a session left open cannot be used to ask
    # which archives exist. Only a ready archive is a backup; the rest describe
    # a file nobody could restore from.
    if archive_status(backup_id) != "ready":
        return _error("That backup is no longer available.", status=404)

    try:
        token, expires_at = issue_download(backup_id)
    except BackupError as failure:
        return _error(str(failure), failure.status)

    created = next(
        (item["createdAt"] for item in list_backups() if item["id"] == backup_id), None
    )
    # The token is deliberately not in the detail: an audit row is readable by
    # every administrator, and the token is the authority to fetch the file.
    log_audit("System", admin, "download backup", "Database", backup_id,
              f"Issued a download link for archive {backup_id} taken {created}")
    db.session.commit()

    return jsonify({
        "url": f"{DOWNLOAD_PATH}/{token}",
        "expiresAt": iso_utc(expires_at),
    }), 200


@backups_bp.get("/backup-downloads/<token>")
def serve_download(token):
    """Streams the archive a token names, once.

    No session check, on purpose: the browser's own downloader fetches this,
    and a URL that works because a cookie happens to be attached would be
    fetchable by any page that could persuade the browser to follow it. The
    token is the authority, it is spent on first use, and it expires in minutes.
    """

    archive = claim_download(token)
    if archive is None:
        return _error(
            "That download link has expired or has already been used. "
            "Ask for another from the backup list.",
            status=404,
        )

    return send_file(
        archive,
        as_attachment=True,
        download_name=archive.name,
        mimetype="application/octet-stream",
    )


@backups_bp.delete("/backups/<backup_id>")
def delete_backup(backup_id):
    """Removes one archive for good.

    Uses the portal's existing re-authentication convention rather than a
    password in the body, like every other delete: the panel has already
    confirmed a password for this stretch of the session, so one confirmation
    covers clearing out several archives instead of a prompt per file.
    """

    admin, error = _superadmin_required()
    if error:
        return error

    _, error = reauth_required("Confirm your password to delete this backup.")
    if error:
        return error

    # A running job may be writing this file, or reading it. Deleting either
    # one out from under the tool turns a clear refusal into a corrupt archive
    # or a half-finished restore.
    if active_job():
        return _error(
            "A backup or restore is running. Wait for it to finish before "
            "deleting an archive.",
            status=409,
        )

    created = next(
        (item["createdAt"] for item in list_backups() if item["id"] == backup_id), None
    )

    if find_archive(backup_id) is None:
        return _error("That backup is no longer available.", status=404)

    if not delete_archive(backup_id):
        return _error("The backup could not be deleted.", status=500)

    log_audit("System", admin, "delete backup", "Database", backup_id,
              f"Deleted archive {backup_id} taken {created}")
    db.session.commit()
    return "", 204


@backups_bp.put("/backups/schedule")
def update_schedule():
    """Saves the automatic backup schedule.

    The row is the source of truth and the timer re-reads it every minute, so
    this takes effect without a restart. Saving deletes nothing by itself: a
    smaller ``keep`` applies after the next completed backup, so lowering the
    limit is never a delete somebody did not expect.
    """

    admin, error = _superadmin_required()
    if error:
        return error

    values, invalid = validate_schedule(request.get_json(silent=True))
    if invalid:
        return jsonify({
            "success": False,
            "message": next(iter(invalid.values())),
            "fields": invalid,
        }), 422

    try:
        row, before = save_schedule(values)
        saved = row.to_dict()
        after = row.describe()
        log_audit("System", admin, "change backup schedule", "Database", None,
                  f"Changed the automatic backup schedule from {before} to {after}")
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to save the backup schedule")
        return _error("The schedule could not be saved.", status=500)

    return jsonify(saved), 200
