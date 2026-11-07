"""Administrator account management for the User Management module.

App users (``public.user``) belong to the User App and stay read-only here.
Administrator accounts (``public.admin``) are the portal's own, so this is where
they are created, deactivated and given their permissions, by superadmins only.
Editing is limited to the signed-in account: every other administrator can be
deactivated or configured, but not rewritten. Any active administrator can list
the accounts and send a password reset code.

Administrators are no longer removed. Deactivation does the same job without
orphaning the audit trail of everything the account did, so the delete route
answers 405 and points at the status route instead.

**Nobody's role changes here.** There are four superadmins, they are named in
``public.superadmin_designation``, and the portal cannot appoint a fifth or
retire one of the four: ``PUT /api/admins/:id/role`` is gone, creating a
superadmin is refused, and a designated account's status cannot be set from
here either. A replacement is a restricted operator procedure run against the
database - see services.superadmin and the "Fixed superadministrators" section
of README.md. Every account this module *can* create is a regular
administrator, and that is the whole of what it can do to who holds the role.

Everything here is superadmin-only except the listing and the password-reset
send, and none of it is grantable through the four permissions: an
administrator who may add, edit, delete and change user statuses still cannot
reach another administrator's account. That, and Backup & Recovery, is what
being a superadmin means.
"""

import re

from flask import Blueprint, jsonify, request, session

from auth import (
    PERMISSION_KEYS,
    Admin,
    admin_required,
    email_taken,
    identity_changed_since,
    identity_claim_lock,
    identity_snapshot,
    STALE_IDENTITY_MESSAGE,
    rate_limited,
    reauth_required,
    release_rate_limit,
    send_password_reset_otp,
    superadmin_required,
)
from extensions import db
from model.record_status import normalized_status, status_label
from services.audit import log_audit
from services.password_rules import first_password_issue
from services.security import hash_password
from services.superadmin import (
    CREATE_SUPERADMIN_MESSAGE,
    DESIGNATED_ACCOUNT_MESSAGE,
    ROLE_FIXED_MESSAGE,
    SUPERADMIN_SET_FIXED_CODE,
    designated_admin_ids,
)

admins_bp = Blueprint("admins", __name__, url_prefix="/api/admins")

# Both spellings a request may name, so an explicit "superadmin" is told the
# policy rather than treated as a typo. Only one of them can be created.
ROLES = ("admin", "superadmin")
ROLE_CHOICE_MESSAGE = "Role must be Administrator."
LAST_SUPERADMIN_MESSAGE = "At least one active superadmin is required."
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Never names the account that holds it. One administrator reading another's
# recovery address out of an error message is the thing this does not do, and
# an address is a duplicate whether the holder keeps it as their primary or
# their alternative - see auth.admins_holding_email.
EMAIL_TAKEN_MESSAGE = "That email address is already in use"


def _error(message, status=400, field=None):
    payload = {"success": False, "message": message}
    if field:
        payload["fields"] = {field: message}
    return jsonify(payload), status


def _fixed_refusal(message, *, status=409, field=None):
    """A refusal that exists because the superadmin set is fixed.

    Carries a code the frontend recognises, so a build left over from before
    this policy - one that still offers Make superadmin, or a role selector -
    can tell "the server does not do this any more" from any other 409 and stop
    offering it, rather than showing the message against a field and leaving
    the control there. 409 rather than 403, like every other refusal here that
    is about the policy instead of about who is asking: a 403 with an
    unrecognised code reads as "confirm your password" to an older client.
    """

    payload = {"success": False, "code": SUPERADMIN_SET_FIXED_CODE, "message": message}
    if field:
        payload["fields"] = {field: message}
    return jsonify(payload), status


def _as_dict(admin, designated=()):
    return {
        "id": str(admin.id),
        "username": admin.username,
        "email": admin.gmail or "",
        "status": status_label(admin.status),
        "role": "superadmin" if admin.is_superadmin else "admin",
        # One of the fixed superadmins, so the portal has nothing it may do to
        # this row: no status change, no permissions, no removal, no role.
        # Reported as a flag rather than left for the client to infer from the
        # role, because what is protected is the *designation* - and because a
        # frontend that inferred it would be guessing at the policy instead of
        # being told it. A build that does not know the key reads it as absent
        # and merely offers actions the server refuses.
        "isProtected": admin.id in designated,
        # Null for a superadmin, whose switches are not configurable, and for
        # an administrator nothing has restricted yet. The frontend reads
        # either as full access. One administrator's switches are not a secret
        # from another - unlike their recovery addresses, which this never
        # returns - because the whole directory is already readable here.
        "permissions": admin.permissions_dto(),
        # The signed-in admin is the only one that can be edited, and the only
        # one whose status and permissions cannot be changed, so the client
        # marks that row rather than offering actions the server would refuse.
        "isCurrent": admin.id == session.get("admin_id"),
    }


ALL_PERMISSIONS_OFF = {key: False for key in PERMISSION_KEYS}

PERMISSIONS_SHAPE_MESSAGE = (
    "Each of the four permissions must be given as true or false."
)

# No longer "demote them first": nobody demotes anybody. Reached only by a
# superadmin that is not designated, which the database does not allow once the
# migration is applied.
SUPERADMIN_PERMISSIONS_MESSAGE = (
    "Superadmins always have every permission, so there is nothing to restrict."
)


def _read_permissions(data, *, default=None):
    """The switches a create or configure body asks for, or ``default``.

    Returns ``(permissions, error_response)``. ``None`` as the permissions is
    meaningful - it is what the four superadmins' rows store - so the two are
    not interchangeable with a falsy check.

    Only an *absent* field defaults. A field that is present and null is a
    value the caller chose to send, and the one shape a supplied value may
    take is the four booleans, so null is refused like any other wrong shape
    (issue #145). Reading the two the same way meant a client could ask for
    "no permissions" and silently receive the view-only default instead of
    being told its request made no sense.

    Every account this module writes is a regular administrator, so there is no
    longer a role for which a supplied set is ignored: creating a superadmin is
    refused before this is reached, and promotion and demotion are gone.
    """

    if not isinstance(data, dict) or "permissions" not in data:
        return default, None

    requested = data["permissions"]
    if not isinstance(requested, dict) or any(
        not isinstance(requested.get(key), bool) for key in PERMISSION_KEYS
    ):
        # All four, every time. A body that names two leaves the other two to
        # whatever the reader assumes, and the two readers here - this server
        # and the form - must not be free to assume differently.
        return None, _error(PERMISSIONS_SHAPE_MESSAGE, field="permissions")

    return {key: requested[key] is True for key in PERMISSION_KEYS}, None


def _describe_permissions(before, after):
    """``add: on -> off`` for each switch that moved, for the audit detail.

    Only the changes, because a row saying all four stayed the same is a row
    nobody reads. ``None`` on either side is full access, which is what a
    superadmin and an unconfigured administrator both hold.
    """

    was = before if before is not None else {key: True for key in PERMISSION_KEYS}
    now = after if after is not None else {key: True for key in PERMISSION_KEYS}
    moved = [
        f"{key}: {'on' if was.get(key) else 'off'} -> {'on' if now.get(key) else 'off'}"
        for key in PERMISSION_KEYS
        if bool(was.get(key)) != bool(now.get(key))
    ]
    return "; ".join(moved)


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
        issue = first_password_issue(password)
        if issue:
            return None, _error(issue, field="password")

    return {"username": username, "email": email, "password": password}, None


def _read_role(value):
    """Returns the stored role a request names, or None when it names neither.

    Still recognises ``superadmin``, which nothing may create: a request that
    names it is answered with the policy rather than with "that is not a
    role", and only a value that is neither is a validation error.
    """

    role = value.strip().lower() if isinstance(value, str) else None
    return role if role in ROLES else None


def _lock_administrators():
    """Locks every administrator row for this transaction and returns them by id.

    Every write that changes who can sign in or what an account may do (status,
    permissions) starts here and decides from what this returns, never from
    rows read earlier. The table holds a handful of accounts, so SELECT ... FOR
    UPDATE over all of it, in id order, is cheap, and it makes these writes
    run one at a time: a second request waits in this query until the first
    commits, rolls back or ends, and then reads the rows as the first left
    them (PostgreSQL re-reads locked rows under READ COMMITTED; populate_existing
    refreshes the ones this session already holds). Taking every row in one
    ordered statement means no request holds a lock while waiting for another.

    The designated superadmins are locked in the same transaction, after the
    administrator rows and in the same order the transfer procedure takes them,
    so a transfer committing mid-request cannot leave this deciding from a set
    of four that has since changed - and so two writers queue rather than
    deadlock.

    The caller is judged again from the locked rows, since its role may have
    changed while it waited. Returns ``(directory, designated, error_response)``.
    """

    rows = Admin.query.order_by(Admin.id).populate_existing().with_for_update().all()
    designated = designated_admin_ids(lock=True)
    _, error = superadmin_required(rows)
    return {row.id: row for row in rows}, designated, error


def _is_last_active_superadmin(record, directory):
    """True when losing this account's superadmin access would leave nobody with it.

    Only an active superadmin counts, so a deactivated one neither blocks the
    change nor is protected by it. ``directory`` is the locked set from
    :func:`_lock_administrators`.

    Kept now that the designated accounts are refused outright, because the two
    rules answer for different deployments. A designated account is protected
    whatever it would leave behind; this one protects a *superadmin that is not
    designated*, which is what every row looks like on a deployment where the
    migration has not been applied yet. Without it such a deployment could
    deactivate its way out of having any superadmin at all during the window
    between the new build and the schema.
    """

    if not (record.is_active and record.is_superadmin):
        return False
    return sum(1 for row in directory.values() if row.is_active and row.is_superadmin) <= 1


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
    # Read once for the whole listing, not per row: the answer is the same set
    # for every account in it.
    designated = designated_admin_ids()
    return jsonify({
        "items": [_as_dict(record, designated) for record in records],
        "total": len(records),
    }), 200


@admins_bp.post("")
def create_admin():
    _, error = superadmin_required()
    if error:
        return error

    values, invalid = _read_identity(request.get_json(silent=True), require_password=True)
    if invalid:
        return invalid

    # Left out (or null) means a plain administrator, which is now the only
    # account this route creates. A body that names a role is still read -
    # "admin" is accepted, anything unrecognized is a field error - so a client
    # that sends the field is not silently given something else.
    requested = request.get_json(silent=True).get("role")
    role = "admin" if requested is None else _read_role(requested)
    if role is None:
        return _error(ROLE_CHOICE_MESSAGE, field="role")

    # Asking for a superadmin is refused, not quietly downgraded: the caller
    # asked for an account with Backup & Recovery and account management, and
    # handing back a regular administrator under the same name would be a
    # different account from the one it thinks it made. Refused before the
    # password confirmation, like a missing role, so nobody is asked to confirm
    # something the answer was always no to.
    if role == "superadmin":
        return _fixed_refusal(CREATE_SUPERADMIN_MESSAGE, field="role")

    # Absent means "nothing yet", not "everything": an account being set up has
    # not been given anything, and the superadmin who creates it decides what it
    # may do. The migration is the other way round, because an account that
    # already exists must not silently lose what it could do yesterday.
    permissions, invalid = _read_permissions(
        request.get_json(silent=True),
        default=ALL_PERMISSIONS_OFF,
    )
    if invalid:
        return invalid

    if _username_taken(values["username"]):
        return _error("That username is already taken", status=409, field="username")

    if email_taken(values["email"]):
        return _error(EMAIL_TAKEN_MESSAGE, status=409, field="email")

    # Every create asks for the password, not only a superadmin's. A new
    # account is a new way into the portal whatever its role, and an unattended
    # session should not be able to mint one.
    _, error = reauth_required("Confirm your password to add an administrator.")
    if error:
        return error

    # Hashed on the way in, so a new account never adds a plaintext row to the
    # ones already there - and before the claim lock, because it is slow.
    password_hash = hash_password(values["password"])

    try:
        with identity_claim_lock:
            # Checked again now that no other claim can commit in between.
            if _username_taken(values["username"]):
                return _error("That username is already taken", status=409, field="username")
            if email_taken(values["email"]):
                return _error(EMAIL_TAKEN_MESSAGE, status=409, field="email")
            # public.admin.id is an identity column, so the database assigns it.
            record = Admin(
                username=values["username"],
                password=password_hash,
                gmail=values["email"],
                role=role,
                permissions=permissions,
            )
            db.session.add(record)
            db.session.flush()
            log_audit("Admin", None, "create", "Administrator", record.id, record.username)
            db.session.commit()
        # No designation is looked up for the new row: it is a regular
        # administrator this request has just inserted, so it cannot be one of
        # the four, and a query to say so would only be able to agree.
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
    # username, email and password are theirs to change, so every other row is
    # read-only here - a superadmin changes their status and permissions
    # through the routes below, never their details.
    #
    # A designated superadmin edits their own row here like anybody else. What
    # is protected is who holds the role, not the account's own password: the
    # four would otherwise have no way to change their own credentials, which
    # would make the protection a reason to keep a stale password.
    if record.id != session.get("admin_id"):
        return _error(
            "You can only edit your own administrator account.",
            status=403,
        )

    values, invalid = _read_identity(request.get_json(silent=True), require_password=False)
    if invalid:
        return invalid

    loaded = identity_snapshot(record)

    if _username_taken(values["username"], excluding_id=admin_id):
        return _error("That username is already taken", status=409, field="username")

    # Only a move is checked, for the same reason PATCH /api/profile checks only
    # what changed: accounts created before the pool existed may already share
    # an address (issue #108), and a rule about new values must not stop those
    # accounts saving a rename. This route edits the caller's own account only,
    # so the pool excludes it.
    email_moved = (values["email"] or "").strip().lower() != (record.gmail or "").strip().lower()
    if email_moved and email_taken(values["email"], excluding_id=admin_id):
        return _error(EMAIL_TAKEN_MESSAGE, status=409, field="email")

    # A blank password leaves the existing one alone; the reset flow is the
    # other way to change it. Hashed before the claim lock, because it is slow.
    password_hash = hash_password(values["password"]) if values["password"] else None

    try:
        with identity_claim_lock:
            if identity_changed_since(record, loaded):
                return _error(STALE_IDENTITY_MESSAGE, status=409)
            # Checked again now that no other claim can commit in between.
            if _username_taken(values["username"], excluding_id=admin_id):
                return _error("That username is already taken", status=409, field="username")
            if email_moved and email_taken(values["email"], excluding_id=admin_id):
                return _error(EMAIL_TAKEN_MESSAGE, status=409, field="email")
            record.username = values["username"]
            record.gmail = values["email"]
            if password_hash:
                record.password = password_hash
            log_audit("Admin", None, "update", "Administrator", record.id, record.username)
            db.session.commit()
        # Asked for even though this route cannot change it: the caller may be
        # one of the four, and an ``admin`` object that reported them
        # unprotected would undo the flag in whatever the client merges it into.
        return jsonify({
            "success": True,
            "message": "Administrator updated successfully.",
            "admin": _as_dict(record, designated_admin_ids()),
        }), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator.", status=500)


@admins_bp.put("/<int:admin_id>/status")
def set_admin_status(admin_id):
    """Activates or deactivates one administrator's access to the portal.

    The reversible counterpart to a delete: the account and its audit trail
    stay, but it can no longer sign in. Unlike the account's own details, this
    is another administrator's to set - unless that administrator is one of the
    four designated superadmins, whose access is not the portal's to set in
    either direction.

    Both directions, because the four are managed outside the portal and not
    merely kept switched on. Containing a compromised one deactivates it
    through the operator procedure; if the portal could switch it back, the
    containment would last until whoever took the account noticed the button.
    """

    _, error = superadmin_required()
    if error:
        return error

    directory, designated, error = _lock_administrators()
    if error:
        return error

    record = directory.get(admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    # Before the body is read, like the self-edit rule above: this is about the
    # account, not about what the request asked for, so there is no status -
    # valid, invalid, or the one it already holds - that makes it answerable.
    # No portal request against one of the four is ever reported as having
    # done something.
    if record.id in designated:
        return _fixed_refusal(DESIGNATED_ACCOUNT_MESSAGE)

    data = request.get_json(silent=True)
    requested = (data or {}).get("status") if isinstance(data, dict) else None
    status = normalized_status(requested, default=None)
    if status is None:
        return _error("Status must be Active or Inactive.", field="status")

    if status == "inactive":
        if record.id == session.get("admin_id"):
            return _error("You cannot deactivate your own administrator account.", status=409)
        # Someone has to be left who can sign in and undo this.
        if sum(1 for row in directory.values() if row.is_active) <= 1:
            return _error("The last active administrator cannot be deactivated.", status=409)
        if _is_last_active_superadmin(record, directory):
            return _error(LAST_SUPERADMIN_MESSAGE, status=409)

    if record.status == status:
        return jsonify({
            "success": True,
            "message": f"{record.username} is already {status_label(status).lower()}.",
            "admin": _as_dict(record, designated),
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
            "admin": _as_dict(record, designated),
        }), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator's status.", status=500)


@admins_bp.put("/<int:admin_id>/role")
def set_admin_role(admin_id):
    """Gone. The superadmin accounts are a fixed set, named in the database.

    This used to promote an administrator and demote a superadmin. That is the
    hole the policy closes: one promotion, by accident or by a stolen session,
    and the four superadmins were five, with a fifth account holding Backup &
    Recovery and everybody else's account. The set now lives in
    ``public.superadmin_designation``, and replacing one of the four is a
    reviewed operator procedure run against the database - not a request any
    portal session can make.

    Retained rather than deleted, and answered here rather than left to Flask's
    own 405, so a client left over from before this deployment gets the
    envelope and the code it can act on - "the server no longer does this",
    which is what tells it to stop offering Make superadmin - instead of a bare
    405 page it would show as an unexpected error.

    Nothing here reads the database, takes a lock, asks for a password or looks
    the target up: there is no request body and no target for which this does
    anything, so a 404 for a missing id would imply that a real one would have
    worked. Registered for every caller, superadmin or not, for the same reason
    the delete route is: the operation does not exist for anybody, and checking
    a role first would imply there is somebody it exists for.
    """

    return jsonify({
        "success": False,
        "code": SUPERADMIN_SET_FIXED_CODE,
        "message": ROLE_FIXED_MESSAGE,
    }), 405


@admins_bp.put("/<int:admin_id>/permissions")
def set_admin_permissions(admin_id):
    """Switches one administrator's four general permissions on or off.

    Deliberate: this is the difference between a colleague who can delete a
    building and one who cannot, so it needs a recent password confirmation,
    and nobody configures their own switches.

    Taking a permission away takes effect on the target's next request. Nothing
    is stored in their session, so there is no cached grant to outlive this.
    """

    # Superadmin is checked before the password so a plain administrator is
    # refused outright rather than asked to confirm something they may not do.
    _, error = superadmin_required()
    if error:
        return error

    _, error = reauth_required(
        "Confirm your password to change this administrator's permissions."
    )
    if error:
        return error

    # Locked because the target's role is what decides this: a superadmin
    # holding a configured set of switches is a state nothing reads, and the
    # read and the write have to agree about which role the row holds.
    directory, designated, error = _lock_administrators()
    if error:
        return error

    record = directory.get(admin_id)
    if not record:
        return _error("Administrator not found.", status=404)

    if record.id == session.get("admin_id"):
        return _error("You cannot change your own permissions.", status=409)

    # One of the four, and so refused for the reason the whole account is
    # managed outside the portal rather than for the reason any superadmin's
    # switches are. Checked first because it is the more specific answer and
    # the one the frontend has a code for.
    if record.id in designated:
        return _fixed_refusal(DESIGNATED_ACCOUNT_MESSAGE)

    # A superadmin that is not designated, which is every superadmin on a
    # deployment where the migration has not been applied yet. Their switches
    # are still not configurable: the role carries everything.
    if record.is_superadmin:
        return _error(SUPERADMIN_PERMISSIONS_MESSAGE, status=409)

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get("permissions") is None:
        return _error(PERMISSIONS_SHAPE_MESSAGE, field="permissions")

    permissions, invalid = _read_permissions(data)
    if invalid:
        return invalid

    # The detail says what moved, so the Logs page answers "who took that
    # away" without anybody diffing two audit rows.
    moved = _describe_permissions(record.permissions_dto(), permissions)

    try:
        record.permissions = permissions
        log_audit(
            "Admin", None, "update permissions", "Administrator", record.id,
            f"{record.username}: {moved or 'no change'}",
        )
        db.session.commit()
        return jsonify({
            "success": True,
            "message": f"Permissions updated for {record.username}.",
            "admin": _as_dict(record, designated),
        }), 200
    except Exception:
        db.session.rollback()
        return _error("Failed to update the administrator's permissions.", status=500)


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
    reservation = []
    limited = rate_limited(
        "admin-reset",
        str(record.id),
        1,
        "A reset code was just sent to that account. Please wait before sending another.",
        reservation=reservation,
    )
    if limited:
        return limited

    try:
        refused = send_password_reset_otp(record)
    except Exception:
        # Nothing reached the colleague and nothing is audited. On a refused
        # delivery the helper has already given back the account's budget and
        # left their current code in place; the minute's hit is returned here,
        # so the sender can try again at once.
        release_rate_limit("admin-reset", str(record.id), reservation)
        db.session.rollback()
        return _error("Failed to send the password reset code.", status=502)

    # The account's own recovery budget, so sending from here cannot hand out
    # more codes than the colleague could have asked for themselves. The refusal
    # arrives already committed, with nothing of this request left to undo.
    if refused:
        return refused

    # Audited because it is an action taken against someone else's account.
    log_audit("Admin", None, "send password reset", "Administrator", record.id, record.username)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": f"A password reset code was sent to {record.gmail}.",
    }), 200


@admins_bp.delete("/<int:admin_id>")
def delete_admin(admin_id):
    """Gone. Administrators are deactivated now, not removed.

    Removing the row orphaned everything the account had ever done: the audit
    trail names an actor by username, and a reader looking up who that was
    found nothing. Deactivation answers the same need - the account can no
    longer sign in - and keeps the history readable, so it replaced this.

    Answered here rather than left to Flask's own 405 so the reply carries the
    usual envelope and names the route that took over. Registered for every
    caller, superadmin or not: the method does not exist for anybody, and
    checking a role first would imply there is a caller for whom it does.

    This is also how a designated superadmin is protected from deletion
    through the portal, and it is the stronger form of it: the method is gone
    for every account rather than refused for four of them, so no request can
    remove one however it is addressed. The status route it points at refuses
    those four in turn, and the database refuses the row itself
    (``guard_designated_admin_delete``) in case anything ever reaches it by
    another path.
    """

    return jsonify({
        "success": False,
        "message": "Administrators are no longer removed. Deactivate the account instead.",
        "deactivate": f"/api/admins/{admin_id}/status",
    }), 405
