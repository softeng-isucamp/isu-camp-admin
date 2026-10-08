"""Administrator account management for the User Management module.

App users (``public.user``) belong to the User App and stay read-only here.
Administrator accounts (``public.admin``) are the portal's own, so this is where
they are created, renamed and removed.
"""

import re

from flask import Blueprint, jsonify, request, session

from auth import Admin, admin_required, reauth_required
from extensions import db
from services.audit import log_audit

admins_bp = Blueprint("admins", __name__, url_prefix="/api/admins")

MIN_PASSWORD_LENGTH = 8
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
        # The signed-in admin cannot remove their own account, so the client
        # marks that row instead of offering an action that would be refused.
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
    _, error = admin_required()
    if error:
        return error

    values, invalid = _read_identity(request.get_json(silent=True), require_password=True)
    if invalid:
        return invalid

    if _username_taken(values["username"]):
        return _error("That username is already taken", status=409, field="username")

    try:
        # public.admin.id is an identity column, so the database assigns it.
        record = Admin(
            username=values["username"],
            password=values["password"],
            gmail=values["email"],
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
            record.password = values["password"]
        log_audit("Admin", None, "update", "Administrator", record.id, record.username)
        db.session.commit()
        return jsonify({"success": True, "message": "Administrator updated successfully.", "admin": _as_dict(record)}), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator.", status=500)


@admins_bp.delete("/<int:admin_id>")
def delete_admin(admin_id):
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

    try:
        username = record.username
        db.session.delete(record)
        log_audit("Admin", None, "delete", "Administrator", admin_id, username)
        db.session.commit()
        return jsonify({"success": True, "message": "Administrator removed successfully."}), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to remove the administrator.", status=500)
