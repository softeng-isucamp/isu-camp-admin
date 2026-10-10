"""The signed-in administrator's own account: My Profile.

Backs ``features/profile/Profile.tsx``, which shipped against a fixture and
had no backend - every call returned 404, and because a preflight must be 2xx
the browser reported a missing route as a CORS policy failure.

Every route here acts on the caller's own account and ignores any id in the
body. ``/api/admins`` is where one administrator administers another, and it
already refuses to edit anyone else's sign-in details; this is the other side
of that rule, so the two together mean an account's username, email and
password are only ever changed by its holder.

Responses are the bare profile object rather than the usual success envelope,
because ``services/profile.ts`` parses the response body directly against its
own schema. Failures keep the envelope, which is what ``apiJson`` reads a
message out of.
"""

import re

from flask import Blueprint, jsonify, request, session

from auth import Admin, admin_required, rate_limited
from extensions import db
from services.audit import log_audit
from services.password_rules import first_password_issue
from services.security import hash_password, verify_password

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")

# The same shape /api/admins accepts, so one account cannot be created with an
# address the other half of the portal would reject.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _error(message, status=400, field=None):
    payload = {"success": False, "message": message}
    if field:
        payload["fields"] = {field: message}
    return jsonify(payload), status


@profile_bp.get("")
def get_profile():
    """The caller's own account."""

    admin, error = admin_required()
    if error:
        return error

    return jsonify(admin.to_profile()), 200


@profile_bp.patch("")
def update_profile():
    """Renames the caller's own account or changes its email address.

    A password change is a separate request with its own re-authentication, so
    this one deliberately ignores a password field if the client sends it.
    """

    admin, error = admin_required()
    if error:
        return error

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return _error("Request body is required")

    username = str(data.get("username") or "").strip()
    email = str(data.get("email") or data.get("gmail") or "").strip()

    if not username:
        return _error("Username is required", field="username")
    if len(username) > 255:
        return _error("Username must be 255 characters or fewer", field="username")
    if not email:
        return _error("Email is required", field="email")
    if not EMAIL_PATTERN.match(email):
        return _error("Enter a valid email address", field="email")

    taken = (
        Admin.query
        .filter(db.func.lower(Admin.username) == username.lower())
        .filter(Admin.id != admin.id)
        .first()
    )
    if taken:
        return _error("That username is already taken", status=409, field="username")

    changes = []
    if username != admin.username:
        changes.append(f"username to {username}")
    if email != (admin.gmail or ""):
        changes.append("email address")

    if not changes:
        # Nothing moved, so there is nothing to audit either.
        return jsonify(admin.to_profile()), 200

    try:
        admin.username = username
        admin.gmail = email
        log_audit(
            "Admin", admin, "update profile", "Administrator", admin.id,
            f"Changed own {' and '.join(changes)}",
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _error("Failed to update your profile.", status=500)

    # The session caches the username for audit attribution, so it has to
    # follow a rename or later entries would credit the old name.
    session["admin_username"] = admin.username

    return jsonify(admin.to_profile()), 200


@profile_bp.post("/password")
def change_password():
    """Replaces the caller's own password, proving the current one first.

    The current password is required even though the session already proves who
    is calling: a session left open on a shared machine should not be enough to
    lock the real holder out of their own account.
    """

    admin, error = admin_required()
    if error:
        return error

    # Guessing the current password is an online attack against an account the
    # attacker already has a session for, so it is rate limited like sign-in.
    limited = rate_limited(
        "change-password",
        str(admin.id),
        5,
        "Too many password change attempts. Please try again later.",
    )
    if limited:
        return limited

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return _error("Request body is required")

    current_password = str(data.get("currentPassword") or "")
    new_password = str(data.get("newPassword") or "")

    if not current_password:
        return _error("Your current password is required", field="currentPassword")
    if not new_password:
        return _error("A new password is required", field="newPassword")

    matches, _ = verify_password(admin.password, current_password)
    if not matches:
        log_audit(
            "Admin", admin, "password change failed", "Administrator", admin.id,
            "Incorrect current password entered",
        )
        db.session.commit()
        return _error("Your current password is incorrect", status=401, field="currentPassword")

    policy_error = first_password_issue(new_password)
    if policy_error:
        return _error(policy_error, field="newPassword")

    if verify_password(admin.password, new_password)[0]:
        return _error(
            "Your new password must be different from your current one",
            field="newPassword",
        )

    try:
        admin.password = hash_password(new_password)
        log_audit(
            "Admin", admin, "change password", "Administrator", admin.id,
            "Changed own password",
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _error("Failed to change your password.", status=500)

    # The session survives on purpose: the holder just proved themselves twice,
    # and signing them out here would be the one thing that makes a successful
    # password change look like a failure.
    return jsonify({"success": True, "message": "Your password was changed."}), 200
