"""The signed-in administrator's own account: My Profile.

Backs ``features/profile/Profile.tsx``, which shipped against a fixture and
had no backend - every call returned 404, and because a preflight must be 2xx
the browser reported a missing route as a CORS policy failure.

Every route here acts on the caller's own account and ignores any id in the
body. ``/api/admins`` is where one administrator administers another, and it
already refuses to edit anyone else's sign-in details; this is the other side
of that rule, so the two together mean an account's username, email addresses
and password are only ever changed by its holder.

An account holds up to two email addresses, and recovery accepts either, so
moving one is moving the way back into the account. That is why this route asks
for the current password before an email change and why it refuses an address
any other administrator already holds - see ``auth.admins_holding_email`` for
the pool both halves of the portal check against.

Responses are the bare profile object rather than the usual success envelope,
because ``services/profile.ts`` parses the response body directly against its
own schema. Failures keep the envelope, which is what ``apiJson`` reads a
message out of.
"""

import re

from flask import Blueprint, jsonify, request, session

from auth import (
    Admin,
    admin_required,
    email_taken,
    identity_claim_lock,
    normalized_email,
    rate_limited,
)
from extensions import db
from services.audit import log_audit
from services.password_rules import first_password_issue
from services.security import hash_password, verify_password

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")

# The same shape /api/admins accepts, so one account cannot be created with an
# address the other half of the portal would reject.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# The width of admin.gmail and admin.alternative_email. A longer address could
# not collide with anything stored, and must not be written either.
EMAIL_MAX_LENGTH = 255

# Sent when an email address is being changed without one, or with a wrong one.
# Two different sentences because they are two different mistakes: one is a
# field the client forgot to collect, the other is a password that is wrong.
PASSWORD_MISSING_MESSAGE = "Enter your current password to change an email address"
PASSWORD_WRONG_MESSAGE = "Your current password is incorrect"

# Never says which account holds the address. Telling the caller that would
# turn this form into a directory of everybody's recovery inboxes.
EMAIL_TAKEN_MESSAGE = "That email address is already in use"


def _error(message, status=400, field=None):
    payload = {"success": False, "message": message}
    if field:
        payload["fields"] = {field: message}
    return jsonify(payload), status


def _refusals(entries, status):
    """One response refusing several fields at once.

    The frontend marks every field in ``fields`` and shows ``message`` at the
    top, so ``message`` is the first refusal in the order the form reads: a
    caller who fixes what the message names has fixed the field their cursor is
    most likely in. ``entries`` is ``[(field, message), ...]`` already in that
    order.
    """

    return jsonify({
        "success": False,
        "message": entries[0][1],
        "fields": dict(entries),
    }), status


def _username_taken(username, own_id):
    """Whether another account holds ``username``, ignoring case.

    Case-insensitive because /api/admins checks it that way, so the two halves
    of the portal cannot disagree about whether a name is free.
    """

    return (
        Admin.query
        .filter(db.func.lower(Admin.username) == username.lower())
        .filter(Admin.id != own_id)
        .first()
    ) is not None


@profile_bp.get("")
def get_profile():
    """The caller's own account."""

    admin, error = admin_required()
    if error:
        return error

    return jsonify(admin.to_profile()), 200


@profile_bp.patch("")
def update_profile():
    """Renames the caller's own account or changes either of its email addresses.

    A password change is a separate request with its own re-authentication, so
    this one deliberately ignores a password field if the client sends it.
    ``currentPassword`` is a different thing: it does not change the password,
    it proves the holder is at the keyboard before an email address - the way
    back into the account - is moved.

    The order of the checks is the security property. Format first, then the
    password, then uniqueness: a session left open on a shared machine can
    neither move an address nor ask this route which addresses exist.
    """

    admin, error = admin_required()
    if error:
        return error

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return _error("Request body is required")

    username = str(data.get("username") or "").strip()
    email = str(data.get("email") or data.get("gmail") or "").strip()

    # Absent means "leave it alone": older clients, and the account page of a
    # build that predates the field, send only username and email. null and ""
    # are how the field is cleared, which is a change like any other.
    alternative_given = "alternativeEmail" in data
    alternative = str(data.get("alternativeEmail") or "").strip()

    if not username:
        return _error("Username is required", field="username")
    if len(username) > 255:
        return _error("Username must be 255 characters or fewer", field="username")

    # Collected rather than returned one at a time: the form shows both email
    # fields together, so refusing them one request at a time would make the
    # caller submit twice to be told about two problems that were both visible
    # on the first attempt.
    invalid = []
    if not email:
        invalid.append(("email", "Email is required"))
    elif len(email) > EMAIL_MAX_LENGTH or not EMAIL_PATTERN.match(email):
        invalid.append(("email", "Enter a valid email address"))

    if alternative:
        if len(alternative) > EMAIL_MAX_LENGTH or not EMAIL_PATTERN.match(alternative):
            invalid.append(("alternativeEmail", "Enter a valid email address"))
        elif normalized_email(alternative) == normalized_email(email):
            # Two copies of one address are one address, and recovery would not
            # know which inbox it had reached.
            invalid.append((
                "alternativeEmail",
                "Use a different address from your primary email",
            ))

    if invalid:
        return _refusals(invalid, 400)

    stored_email = normalized_email(admin.gmail)
    stored_alternative = normalized_email(admin.alternative_email)
    email_changed = normalized_email(email) != stored_email
    alternative_changed = (
        alternative_given and normalized_email(alternative) != stored_alternative
    )
    username_changed = username.lower() != (admin.username or "").lower()

    # Required only for an email change. A rename is visible to the holder on
    # their next page load and undoable by them; an email address is the route
    # back into the account, so moving one is the step that asks.
    if email_changed or alternative_changed:
        current_password = str(data.get("currentPassword") or "")
        if not current_password:
            return _error(PASSWORD_MISSING_MESSAGE, status=401, field="currentPassword")

        # Rate limited like the password change route: this is an online guess
        # against an account the caller already has a session for.
        limited = rate_limited(
            "profile-email",
            str(admin.id),
            5,
            "Too many attempts. Please try again later.",
        )
        if limited:
            return limited

        matches, _ = verify_password(admin.password, current_password)
        if not matches:
            log_audit(
                "Admin", admin, "email change failed", "Administrator", admin.id,
                "Incorrect current password entered for an email address change",
            )
            db.session.commit()
            return _error(PASSWORD_WRONG_MESSAGE, status=401, field="currentPassword")

    # Only what moved is checked for a duplicate. Accounts created before the
    # pool existed may already share a primary address (issue #108), so
    # checking an unchanged field would leave those accounts unable to save a
    # rename - a rule about new values enforcing itself against old ones that
    # nobody can fix from this form.
    def conflicts():
        found = []
        if username_changed and _username_taken(username, admin.id):
            found.append(("username", "That username is already taken"))
        if email_changed and email_taken(email, excluding_id=admin.id):
            found.append(("email", EMAIL_TAKEN_MESSAGE))
        if alternative_changed and alternative and email_taken(alternative, excluding_id=admin.id):
            found.append(("alternativeEmail", EMAIL_TAKEN_MESSAGE))
        return found

    found = conflicts()
    if found:
        return _refusals(found, 409)

    changes = []
    if username != admin.username:
        changes.append(f"username to {username}")
    if email_changed:
        changes.append("email address")
    if alternative_changed:
        changes.append("alternative email" if alternative else "alternative email (cleared)")

    if not changes:
        # Nothing moved, so there is nothing to audit either.
        return jsonify(admin.to_profile()), 200

    try:
        with identity_claim_lock:
            # Checked again now that no other claim can commit in between.
            found = conflicts()
            if found:
                return _refusals(found, 409)
            admin.username = username
            admin.gmail = email
            if alternative_given:
                # NULL rather than "", so the column has one spelling for "none".
                admin.alternative_email = alternative or None
            log_audit(
                "Admin", admin, "update profile", "Administrator", admin.id,
                # The addresses themselves are left out on purpose: the audit
                # log is readable by every administrator, and the password is
                # never written anywhere.
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
