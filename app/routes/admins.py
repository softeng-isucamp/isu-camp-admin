"""Administrator account management for the User Management module.

App users (``public.user``) belong to the User App and stay read-only here.
Administrator accounts (``public.admin``) are the portal's own, so this is where
they are created, deactivated, given a role and removed, by superadmins only.
Editing is limited to the signed-in account: every other administrator can be
deactivated or removed, but not rewritten. Any active administrator can list
the accounts and send a password reset code.
"""

import re

from flask import Blueprint, jsonify, request, session

from auth import (
    Admin,
    admin_required,
    rate_limited,
    reauth_required,
    send_password_reset_otp,
    superadmin_required,
)
from extensions import db
from model.record_status import normalized_status, status_label
from services.audit import log_audit
from services.security import hash_password

admins_bp = Blueprint("admins", __name__, url_prefix="/api/admins")

MIN_PASSWORD_LENGTH = 8
ROLES = ("admin", "superadmin")
LAST_SUPERADMIN_MESSAGE = "At least one active superadmin is required. Promote another account first."
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _error(message, status=400, field=None):
    payload = {"success": False, "message": message}
    if field:
        payload["fields"] = {field: message}
    return jsonify(payload), status


def _as_dict(admin):
    return {
        "id": str(admin.id),
        "username": admin.username,
        "email": admin.gmail or "",
        "status": status_label(admin.status),
        "role": "superadmin" if admin.is_superadmin else "admin",
        # The signed-in admin is the only one that can be edited, and the only
        # one that cannot be deactivated or removed, so the client marks that
        # row rather than offering actions the server would refuse.
        "isCurrent": admin.id == session.get("admin_id"),
    }


def _read_identity(data, *, require_password):
    """Validates a create/update body and returns (values, error_response)."""

    if not isinstance(data, dict) or not data:
        return None, _error("Request body is required")

    username = str(data.get("username") or "").strip()
    email = str(data.get("email") or data.get("gmail") or "").strip()
    password = str(data.get("password") or "")

    if not username:
        return None, _error("Username is required", field="username")
    if len(username) > 255:
        return None, _error("Username must be 255 characters or fewer", field="username")
    if not email:
        return None, _error("Email is required", field="email")
    if not EMAIL_PATTERN.match(email):
        return None, _error("Enter a valid email address", field="email")
    if require_password or password:
        if len(password) < MIN_PASSWORD_LENGTH:
            return None, _error(
                f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
                field="password",
            )

    return {"username": username, "email": email, "password": password}, None


def _read_role(value):
    """Returns the stored role a request names, or None when it names neither."""

    role = value.strip().lower() if isinstance(value, str) else None
    return role if role in ROLES else None


def _is_last_active_superadmin(record):
    """True when losing this account's superadmin access would leave nobody with it.

    Only an active superadmin counts, so a deactivated one neither blocks the
    change nor is protected by it. Applies to demoting, deactivating and
    removing alike.

    The check and the write that follows it must not interleave with another
    administrator's, or two superadmins acting on each other could both pass.
    So this first takes a row lock on every active superadmin (SELECT ... FOR
    UPDATE, in id order so two requests cannot deadlock). The lock lasts until
    the caller commits, rolls back or the request ends, which makes a second
    request wait here; when it resumes, PostgreSQL re-reads the locked rows, so
    it sees the first one's change and counts what is really left. The rows are
    also refreshed (populate_existing), so ``record`` is judged on its current
    state rather than what this request read before waiting. An account that
    is not an active superadmin does not need any of that, so it is not locked.
    """

    if not (record.is_active and record.is_superadmin):
        return False
    active_superadmins = (
        Admin.query.filter(Admin.role == "superadmin")
        .filter(Admin.status == "active")
        .order_by(Admin.id)
        .populate_existing()
        .with_for_update()
        .all()
    )
    if not (record.is_active and record.is_superadmin):
        return False
    return len(active_superadmins) <= 1


def _username_taken(username, *, excluding_id=None):
    query = Admin.query.filter(db.func.lower(Admin.username) == username.lower())
    if excluding_id is not None:
        query = query.filter(Admin.id != excluding_id)
    return query.first() is not None


@admins_bp.get("")
def list_admins():
    _, error = admin_required()
    if error:
        return error

    records = Admin.query.order_by(Admin.username.asc()).all()
    return jsonify({"items": [_as_dict(record) for record in records], "total": len(records)}), 200


@admins_bp.post("")
def create_admin():
    _, error = superadmin_required()
    if error:
        return error

    values, invalid = _read_identity(request.get_json(silent=True), require_password=True)
    if invalid:
        return invalid

    # Left out (or null) means a plain administrator; anything else must name a role.
    requested = request.get_json(silent=True).get("role")
    role = "admin" if requested is None else _read_role(requested)
    if role is None:
        return _error("Role must be Administrator or Superadmin.", field="role")

    if _username_taken(values["username"]):
        return _error("That username is already taken", status=409, field="username")

    # Minting a superadmin is as deliberate as promoting one, so it asks for the
    # password too. A plain administrator is created without the prompt.
    if role == "superadmin":
        _, error = reauth_required("Confirm your password to create a superadmin.")
        if error:
            return error

    try:
        # public.admin.id is an identity column, so the database assigns it.
        record = Admin(
            username=values["username"],
            # Hashed on the way in, so a new account never adds a
            # plaintext row to the ones already there.
            password=hash_password(values["password"]),
            gmail=values["email"],
            role=role,
        )
        db.session.add(record)
        db.session.flush()
        log_audit("Admin", None, "create", "Administrator", record.id, record.username)
        db.session.commit()
        return jsonify({"success": True, "message": "Administrator added successfully.", "admin": _as_dict(record)}), 201
    except Exception:
        db.session.rollback()
        return _error("Failed to add the administrator.", status=500)


@admins_bp.put("/<int:admin_id>")
def update_admin(admin_id):
    _, error = admin_required()
    if error:
        return error

    record = db.session.get(Admin, admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    # An administrator owns only their own sign-in details. Another account's
    # username, email and password are theirs to change, so the rest of the
    # directory is remove-only here.
    if record.id != session.get("admin_id"):
        return _error(
            "You can only edit your own administrator account.",
            status=403,
        )

    values, invalid = _read_identity(request.get_json(silent=True), require_password=False)
    if invalid:
        return invalid

    if _username_taken(values["username"], excluding_id=admin_id):
        return _error("That username is already taken", status=409, field="username")

    try:
        record.username = values["username"]
        record.gmail = values["email"]
        # A blank password leaves the existing one alone; the reset flow is the
        # other way to change it.
        if values["password"]:
            record.password = hash_password(values["password"])
        log_audit("Admin", None, "update", "Administrator", record.id, record.username)
        db.session.commit()
        return jsonify({"success": True, "message": "Administrator updated successfully.", "admin": _as_dict(record)}), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator.", status=500)


@admins_bp.put("/<int:admin_id>/status")
def set_admin_status(admin_id):
    """Activates or deactivates one administrator's access to the portal.

    The reversible counterpart to a delete: the account and its audit trail
    stay, but it can no longer sign in. Unlike the account's own details, this
    is another administrator's to set.
    """

    _, error = superadmin_required()
    if error:
        return error

    record = db.session.get(Admin, admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    data = request.get_json(silent=True)
    requested = (data or {}).get("status") if isinstance(data, dict) else None
    status = normalized_status(requested, default=None)
    if status is None:
        return _error("Status must be Active or Inactive.", field="status")

    if status == "inactive":
        if record.id == session.get("admin_id"):
            return _error("You cannot deactivate your own administrator account.", status=409)
        # Someone has to be left who can sign in and undo this.
        active_admins = Admin.query.filter(Admin.status == "active").count()
        if active_admins <= 1:
            return _error("The last active administrator cannot be deactivated.", status=409)
        if _is_last_active_superadmin(record):
            return _error(LAST_SUPERADMIN_MESSAGE, status=409)

    if record.status == status:
        return jsonify({
            "success": True,
            "message": f"{record.username} is already {status_label(status).lower()}.",
            "admin": _as_dict(record),
        }), 200

    try:
        record.status = status
        action = "deactivate" if status == "inactive" else "activate"
        log_audit("Admin", None, action, "Administrator", record.id, record.username)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": f"{record.username} was "
                       f"{'deactivated' if status == 'inactive' else 'activated'} successfully.",
            "admin": _as_dict(record),
        }), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator's status.", status=500)


@admins_bp.put("/<int:admin_id>/role")
def set_admin_role(admin_id):
    """Promotes an administrator to superadmin or demotes a superadmin.

    Shaped like the status route. Granting or withdrawing account management is
    deliberate, so it needs a recent password confirmation, and an account
    cannot change its own role.
    """

    # Superadmin is checked before the password so a plain administrator is
    # refused outright rather than asked to confirm something they may not do.
    _, error = superadmin_required()
    if error:
        return error

    _, error = reauth_required("Confirm your password to change this administrator's role.")
    if error:
        return error

    record = db.session.get(Admin, admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    data = request.get_json(silent=True)
    role = _read_role(data.get("role") if isinstance(data, dict) else None)
    if role is None:
        return _error("Role must be Administrator or Superadmin.", field="role")

    if record.id == session.get("admin_id"):
        return _error("You cannot change your own role.", status=409)

    noun = "a superadmin" if role == "superadmin" else "an administrator"
    if record.is_superadmin == (role == "superadmin"):
        return jsonify({
            "success": True,
            "message": f"{record.username} is already {noun}.",
            "admin": _as_dict(record),
        }), 200

    if role == "admin" and _is_last_active_superadmin(record):
        return _error(LAST_SUPERADMIN_MESSAGE, status=409)

    try:
        record.role = role
        action = "promote" if role == "superadmin" else "demote"
        log_audit("Admin", None, action, "Administrator", record.id, record.username)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": f"{record.username} was "
                       f"{'promoted to superadmin' if role == 'superadmin' else 'demoted to administrator'} successfully.",
            "admin": _as_dict(record),
        }), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator's role.", status=500)


@admins_bp.post("/<int:admin_id>/password-reset")
def send_password_reset(admin_id):
    """Emails a reset code to one administrator's registered address.

    The way to help a locked-out colleague without editing their account: the
    code goes to their own inbox, never to the caller's screen.
    """

    _, error = admin_required()
    if error:
        return error

    record = db.session.get(Admin, admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    if not record.gmail:
        return _error(
            "That account has no email address on file, so a reset code cannot be sent.",
            status=409,
        )

    # One code a minute per account, so a colleague's inbox cannot be flooded.
    limited = rate_limited(
        "admin-reset",
        str(record.id),
        1,
        "A reset code was just sent to that account. Please wait before sending another.",
    )
    if limited:
        return limited

    try:
        send_password_reset_otp(record)
    except Exception:
        return _error("Failed to send the password reset code.", status=502)

    # Audited because it is an action taken against someone else's account.
    log_audit("Admin", None, "send password reset", "Administrator", record.id, record.username)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": f"A password reset code was sent to {record.gmail}.",
    }), 200


@admins_bp.delete("/<int:admin_id>")
def delete_admin(admin_id):
    # Superadmin is checked before the password so a plain administrator is
    # refused outright rather than asked to confirm something they may not do.
    _, error = superadmin_required()
    if error:
        return error

    # Removing an administrator is destructive, so it needs a recent password
    # confirmation like every other delete in the portal.
    _, error = reauth_required()
    if error:
        return error

    record = db.session.get(Admin, admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    if record.id == session.get("admin_id"):
        return _error("You cannot remove your own administrator account.", status=409)

    if Admin.query.count() <= 1:
        return _error("The last administrator account cannot be removed.", status=409)

    if _is_last_active_superadmin(record):
        return _error(LAST_SUPERADMIN_MESSAGE, status=409)

    try:
        username = record.username
        db.session.delete(record)
        log_audit("Admin", None, "delete", "Administrator", admin_id, username)
        db.session.commit()
        return jsonify({"success": True, "message": "Administrator removed successfully."}), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to remove the administrator.", status=500)
