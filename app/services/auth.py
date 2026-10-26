from collections import defaultdict, deque
import hashlib
import hmac
import logging
import math
import re
import threading
import time

from flask import Blueprint, current_app, request, jsonify, session
from flask_mail import Message
from dotenv import load_dotenv
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError

from extensions import db, mail
from model.recovery_attempt import RecoveryAttempt
from services.audit import log_audit
from services.password_rules import first_password_issue
from services.security import (
    burn_password_comparison,
    hash_password,
    verify_password,
)

import secrets
from datetime import datetime, timedelta, timezone

load_dotenv()


# ==========================================
# Authentication Blueprint
# ==========================================

auth_bp = Blueprint(
    "auth",
    __name__,
    url_prefix="/api"
)

logger = logging.getLogger(__name__)


# ==========================================
# Temporary Password Reset OTP Storage
# ==========================================

# Keyed by username for the legacy /api/reset/* routes and the admin-triggered
# reset, and by (purpose, email) for /api/recovery/*, so the two never collide.
# Every read and write holds ``recovery_lock``: the recovery sweep iterates this
# dict, and the API serves requests on several threads.
reset_otps = {}

# Serializes the legacy username-keyed flow from issuing a code to committing
# the password it redeems, so a code replaced while its request was hashing can
# no longer be redeemed, and no new code is issued between a redemption's check
# and its commit. Taken before ``recovery_lock``, never while holding it.
legacy_reset_lock = threading.Lock()

OTP_LIFETIME_SECONDS = 600


def generate_otp():
    return f"{secrets.randbelow(1000000):06d}"


def otp_expiry():
    return datetime.utcnow() + timedelta(seconds=OTP_LIFETIME_SECONDS)


# These buckets are intentionally small and local to the backend process. They
# protect the current deployment without adding a new infrastructure service;
# a shared store can replace this seam when the app is scaled horizontally.
RATE_LIMIT_WINDOW_SECONDS = 60
rate_limit_buckets = defaultdict(deque)
rate_limit_lock = threading.Lock()
rate_limit_swept_at = None


def reclaim_idle_rate_limit_buckets(now):
    """Drops buckets whose hits have all left the window.

    Such a bucket would be emptied by its next call anyway, so dropping it
    changes no verdict; it only stops keys that are never seen again, such as
    one per unknown email, from accumulating. Runs at most once a window.
    """
    global rate_limit_swept_at
    if rate_limit_swept_at is not None and 0 <= now - rate_limit_swept_at < RATE_LIMIT_WINDOW_SECONDS:
        return
    rate_limit_swept_at = now
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    for key in [k for k, bucket in list(rate_limit_buckets.items()) if not bucket or max(bucket) <= cutoff]:
        rate_limit_buckets.pop(key, None)


def rate_limited(scope, key, limit, message):
    with rate_limit_lock:
        # Read inside the lock so hits are stored in the order they were
        # taken; hits are still judged by value, not position.
        now = time.monotonic()
        reclaim_idle_rate_limit_buckets(now)
        bucket = rate_limit_buckets[(scope, key)]
        cutoff = now - RATE_LIMIT_WINDOW_SECONDS
        if bucket and min(bucket) <= cutoff:
            live = [hit for hit in bucket if hit > cutoff]
            bucket.clear()
            bucket.extend(live)
        if len(bucket) >= limit:
            retry_after = max(1, math.ceil(RATE_LIMIT_WINDOW_SECONDS - (now - min(bucket))))
        else:
            bucket.append(now)
            return None
    # The code says which kind of 429 this is. A flood limit is about how fast
    # this client is going and lifts in seconds; an account restriction is
    # about the account and lasts minutes, so the frontend must be able to tell
    # them apart without reading the message.
    response = jsonify({"success": False, "code": RATE_LIMITED_CODE, "message": message})
    response.headers["Retry-After"] = str(retry_after)
    return response, 429


# ==========================================
# Admin Model
# ==========================================

class Admin(db.Model):

    __tablename__ = "admin"

    __table_args__ = {
        "schema": "public"
    }

    id = db.Column(
        db.SmallInteger,
        primary_key=True
    )

    username = db.Column(
        db.String(255),
        unique=True,
        nullable=False
    )

    password = db.Column(
        db.String(255),
        nullable=False
    )

    gmail = db.Column(
        db.String(255),
        nullable=False
    )

    # An optional second address, offered alongside gmail for account recovery.
    # NULL when none is registered, which is also how the routes clear it: an
    # empty string would be a second spelling of "none". The two columns are
    # one pool for uniqueness - see admins_holding_email - but the database
    # does not enforce that, because accounts predating the rule already share
    # primary addresses. See migrations/20261023_add_admin_alternative_email.sql.
    alternative_email = db.Column(
        db.String(255),
        nullable=True
    )

    # Whether this account may sign in, lowercase per model.record_status. The
    # column arrived with User Management's Activate/Deactivate action; rows
    # that predate it were defaulted to active.
    status = db.Column(
        db.String(20),
        nullable=False,
        default="active"
    )

    # Which parts of the portal this account may reach. Only two values, and
    # only one of them means anything beyond a label: Backup & Recovery is
    # superadmin-only. Rows that predate the column default to 'admin', so a
    # deployment grants the first superadmin deliberately rather than by
    # accident. See migrations/20261010_add_admin_role.sql.
    role = db.Column(
        db.String(20),
        nullable=False,
        default="admin"
    )

    # Which of the four general actions this administrator may take, as
    # ``{"add": bool, "edit": bool, "delete": bool, "changeUserStatus": bool}``.
    #
    # NULL means "every one of them", which is what makes this column safe to
    # add to a running deployment: rows that predate it keep the access they
    # had, and a superadmin's switches are NULL because the role already
    # carries everything. Viewing is not a switch - it is the least-privilege
    # minimum, and an account that should see nothing is deactivated instead.
    #
    # One JSON value rather than four columns because the four are always read
    # and written together, and the API carries them as one object. See
    # migrations/20261024_add_admin_permissions.sql.
    #
    # ``none_as_null`` on both variants, because a JSON column has two
    # different nothings and only one of them is the one meant here. Left to
    # its default, assigning Python None stores the JSON scalar ``null`` - a
    # value - rather than SQL NULL, and the migration's shape constraint
    # rejects it: jsonb_typeof('null') is 'null', not 'object'. That made
    # creating a superadmin and promoting an administrator fail with a check
    # violation, since both assign None deliberately (issue #145). SQLite has
    # no such constraint, which is why only PostgreSQL showed it.
    permissions = db.Column(
        JSONB(none_as_null=True).with_variant(db.JSON(none_as_null=True), "sqlite"),
        nullable=True
    )

    @property
    def is_active(self):
        return (self.status or "active") == "active"

    @property
    def is_superadmin(self):
        return (self.role or "admin") == "superadmin"

    def permissions_dto(self):
        """The four switches as every response carries them, or None.

        None is "all four on", and it is what a superadmin and an unconfigured
        administrator both report: the frontend reads a missing or null
        ``permissions`` as full access, which is how this field could be added
        to a live contract without changing what any existing build may do.
        """

        if self.is_superadmin:
            return None
        return granted_permissions(self.permissions)

    def may(self, action):
        """Whether this account may take ``action``, one of PERMISSION_KEYS."""

        return admin_may(self, action)

    def to_profile(self):
        """The account as My Profile reads it.

        Not wrapped in the usual success envelope: the frontend parses this
        response body directly against its own schema (services/profile.ts),
        so the fields sit at the top level.

        ``alternativeEmail`` is always present, ``null`` when none is
        registered. Its presence is what tells My Profile the server knows
        about the field at all: a build talking to an older API sees no key and
        hides the control rather than offering an edit that would be dropped.
        """
        return {
            "id": str(self.id),
            "username": self.username,
            "email": self.gmail or "",
            "alternativeEmail": self.alternative_email or None,
            "role": "superadmin" if self.is_superadmin else "admin",
            # Read off the row on every call, never off the session cookie, so
            # a switch a superadmin has just turned off takes effect the next
            # time the portal asks who it is signed in as - without the
            # administrator signing out and in again.
            "permissions": self.permissions_dto(),
        }


# ==========================================
# Per-Administrator Permissions
# ==========================================

# The four general actions a regular administrator can be given or refused.
# Viewing is deliberately not among them: it is the least-privilege minimum
# every active account keeps, so restricting someone to nothing is a
# deactivation, not a permission.
#
# The keys are the ones the API carries, camelCase and all, because this object
# is handed to the frontend unchanged and a second spelling on the way out
# would be a second thing to keep in step.
PERMISSION_KEYS = ("add", "edit", "delete", "changeUserStatus")

# The frontend recognises this code, not the message text, so it can re-read
# the signed-in account's permissions and stop offering an action that has just
# been taken away.
PERMISSION_DENIED_CODE = "PERMISSION_DENIED"

PERMISSION_DENIED_MESSAGE = "You don't have permission to do that. Ask a superadmin."


def granted_permissions(stored):
    """A stored permissions value as the four booleans, or None for full access.

    None covers everything that is not a configured set of switches: a NULL
    column, a row written before the column existed, and anything that is not
    an object. All of them mean "no restriction recorded", which keeps this
    column safe to introduce - no deployment loses access by upgrading, and a
    mangled value fails open rather than locking a campus out of its own map.

    A key missing from a value that *is* an object is a different matter: the
    set was configured and that switch is not in it, so it reads as off.
    """

    if not isinstance(stored, dict):
        return None
    return {key: stored.get(key) is True for key in PERMISSION_KEYS}


def admin_may(admin, action):
    """Whether ``admin`` may take ``action``.

    Superadmins may do everything - their switches are not configurable, and
    restricting one means demoting it first. Everyone else is judged by the
    stored object, with the NULL-means-everything rule above.

    Read with ``getattr`` rather than attribute access so this also answers for
    a caller that is not a full row.
    """

    if getattr(admin, "is_superadmin", False):
        return True
    granted = granted_permissions(getattr(admin, "permissions", None))
    return True if granted is None else granted.get(action, False)


# ==========================================
# The Shared Email Pool
# ==========================================

# One administrator's two addresses and every other administrator's are a
# single pool: an address is taken if anybody holds it as either of theirs.
# Recovery is the reason. Both addresses can be typed into Forgot password, so
# an address shared by two accounts would be a code that could reach the wrong
# inbox, or a username disclosed to whoever asked - which is exactly why
# find_recovery_admin refuses an ambiguous address rather than guessing.
#
# The database does not enforce it (see the migration): accounts predating the
# rule already share primary addresses, so the check lives here and is applied
# only to the field a request is actually changing. An existing duplicate then
# blocks nothing but a change to the duplicated field itself.


def normalized_email(value):
    """An address in the form addresses are compared in: trimmed, lowercased.

    ``''`` for anything that is not a usable string, including None, so a
    caller can treat "no address" and "not an address" the same way.
    """

    if not isinstance(value, str):
        value = "" if value is None else str(value)
    return value.strip().lower()


def admins_holding_email(email, *, excluding_id=None, limit=2):
    """Administrators whose primary or alternative address is ``email``.

    Compared trimmed and case-insensitively on both sides, so a stored address
    that was saved with stray whitespace still collides. ``excluding_id`` drops
    one account from the pool, which is how an administrator keeps an address
    they already hold.

    ``limit`` is two by default because two is enough to know an address is
    ambiguous, and nothing in the schema makes it unique.
    """

    compared = normalized_email(email)
    if not compared:
        return []

    query = Admin.query.filter(db.or_(
        func.lower(func.trim(Admin.gmail)) == compared,
        func.lower(func.trim(Admin.alternative_email)) == compared,
    ))
    if excluding_id is not None:
        query = query.filter(Admin.id != excluding_id)
    return query.limit(limit).all()


def email_taken(email, *, excluding_id=None):
    """Whether any other administrator already holds ``email`` as either address."""

    return bool(admins_holding_email(email, excluding_id=excluding_id, limit=1))


# Checking the shared email pool (and usernames) and committing a claim on it
# are one step: nothing in the schema makes an address unique, so two requests
# that each saw it free would both commit. Every writer of a username, gmail or
# alternative_email re-checks under this lock and holds it through its commit,
# and does slow work such as hashing before taking it. One process serves the
# API, so a process lock is enough; several would need a database advisory lock.
identity_claim_lock = threading.Lock()


# ==========================================
# LOGIN
# ==========================================

@auth_bp.route("/login", methods=["POST"])
def login():

    try:

        data = request.get_json(silent=True)

        limited = rate_limited(
            "login",
            request.remote_addr or "unknown",
            5,
            "Too many authentication requests. Please try again later.",
        )
        if limited:
            return limited

        if not isinstance(data, dict) or not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        username = data.get("username")
        password = data.get("password")

        if not username or not password:
            return jsonify({
                "success": False,
                "message": "Username and password are required"
            }), 400

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:
            # Spend the same work as a real check, so a missing username is not
            # distinguishable from a wrong password by how long the reply takes.
            burn_password_comparison(password)
            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

        matches, needs_rehash = verify_password(admin.password, password)
        if not matches:
            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

        if needs_rehash:
            # The row still held plaintext. A correct sign-in is the one moment
            # the raw password is available to hash, so take it.
            admin.password = hash_password(password)

        # Checked after the password so a wrong guess cannot discover which
        # accounts exist and are deactivated.
        if not admin.is_active:
            log_audit(
                "System", admin, "login refused", "Admin", admin.id,
                "Sign-in refused: the account is deactivated"
            )
            db.session.commit()
            return jsonify({
                "success": False,
                "message": "This administrator account has been deactivated. "
                           "Ask another administrator to reactivate it."
            }), 403

        # Permanent is what makes Flask stamp PERMANENT_SESSION_LIFETIME onto
        # the cookie. Without it the cookie dies when the browser closes but
        # carries no expiry of its own, so a copy taken off the wire or off
        # disk stays valid indefinitely. See the session block in
        # services/database.py.
        session.permanent = True
        session["admin_id"] = admin.id
        session["admin_username"] = admin.username
        session.permanent = bool(data.get("remember", False))
        log_audit("System", admin, "login", "Admin", admin.id, "Admin login successful")
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Login successful",
            # role and email are what the portal's Shell and My Profile read off
            # the session. The frontend treats a missing role as not superadmin,
            # so leaving them out silently disables the superadmin gate.
            "admin": admin.to_profile()
        }), 200

    except Exception:

        logger.exception("Login failed")

        return jsonify({
            "success": False,
            "message": "Login failed"
        }), 500


# ==========================================
# LOGOUT
# ==========================================

@auth_bp.route("/logout", methods=["POST"])
def logout():
    actor = session.get("admin_username") or "system"
    log_audit("System", actor, "logout", "Admin", session.get("admin_id"), "Admin logout")
    db.session.commit()
    session.clear()

    return jsonify({
        "success": True,
        "message": "Logout successful"
    }), 200


# ==========================================
# CURRENT ADMIN
# ==========================================

@auth_bp.route("/me", methods=["GET"])
def current_admin():

    admin_id = session.get("admin_id")

    if not admin_id:
        return jsonify({
            "authenticated": False,
            "message": "Not authenticated"
        }), 401

    admin = db.session.get(Admin, admin_id)

    if not admin:

        session.clear()

        return jsonify({
            "authenticated": False,
            "message": "Admin account not found"
        }), 401

    # The portal asks here whether its session is still good, so a deactivated
    # administrator is signed out of the UI rather than left on a dead session.
    if not admin.is_active:

        session.clear()

        return jsonify({
            "authenticated": False,
            "message": "This administrator account has been deactivated."
        }), 401

    return jsonify({
        "authenticated": True,
        "admin": admin.to_profile()
    }), 200


# ==========================================
# AUTHENTICATION HELPER
# ==========================================

def admin_required():

    admin_id = session.get("admin_id")

    if not admin_id:

        return None, (
            jsonify({
                "success": False,
                "message": "Authentication required"
            }),
            401
        )

    admin = db.session.get(Admin, admin_id)

    if not admin:

        session.clear()

        return None, (
            jsonify({
                "success": False,
                "message": "Admin account not found"
            }),
            401
        )

    # Deactivation takes effect on the next request, so an administrator who is
    # signed in when their account is deactivated does not keep working.
    if not admin.is_active:

        session.clear()

        return None, (
            jsonify({
                "success": False,
                "message": "This administrator account has been deactivated."
            }),
            401
        )

    return admin, None


# The frontend recognises this code, not the message text, to tell a missing
# role apart from any other 403.
SUPERADMIN_REQUIRED_CODE = "superadmin_required"


def superadmin_required(locked=None):
    """Guard a route that only a superadmin may use.

    Returns ``(admin, None)`` or ``(None, response)`` like
    :func:`admin_required`, so routes can chain the two. The role is read from
    the row on every request, so a demoted account is refused on its next call
    without its session being invalidated.

    A route that writes under a row lock on the administrator table passes the
    locked rows as ``locked``, to check again that the caller still holds the
    role. The caller is then judged from those rows alone, so an account that
    was demoted, deactivated or removed while the request waited is refused
    with the same response.
    """

    if locked is None:
        admin, error = admin_required()
        if error:
            return None, error
    else:
        admin = next((row for row in locked if row.id == session.get("admin_id")), None)

    if admin is None or not (admin.is_active and admin.is_superadmin):
        return None, (
            jsonify({
                "success": False,
                "code": SUPERADMIN_REQUIRED_CODE,
                "message": "Superadmin access required"
            }),
            403
        )

    return admin, None


def permission_denied(message=None):
    """The 403 a refused action answers with."""

    return (
        jsonify({
            "success": False,
            "code": PERMISSION_DENIED_CODE,
            "message": message or PERMISSION_DENIED_MESSAGE,
        }),
        403
    )


def permission_error(admin, action, message=None):
    """None when ``admin`` may take ``action``, otherwise the 403 to return.

    The check, separated from the authentication around it, so a route that has
    already loaded its caller - or has to weigh several changes in one payload,
    as POST /api/map/save does - can ask about each one without looking the
    account up again.
    """

    if action is None or admin_may(admin, action):
        return None
    return permission_denied(message)


def permission_required(action):
    """Guard a write route behind one of the four permissions.

    Returns ``(admin, None)`` or ``(None, response)`` like
    :func:`admin_required`, which it builds on, so routes can chain the two.
    The switches are read from the row on every request, exactly as
    :func:`superadmin_required` reads the role, so withdrawing one takes effect
    on the caller's next request rather than at their next sign-in.

    Checked *before* any password confirmation: an administrator who may not
    delete is told so outright rather than asked to confirm a password for
    something the answer was always no to.
    """

    admin, error = admin_required()
    if error:
        return None, error

    denied = permission_error(admin, action)
    if denied:
        return None, denied


# ==========================================
# PASSWORD CONFIRMATION FOR DESTRUCTIVE ACTIONS
# ==========================================

# How long one password confirmation authorizes deletes for. Short enough that
# an unattended session cannot be used to delete records, long enough to clear
# a hierarchy without retyping the password for every record.
REAUTH_MAX_AGE_SECONDS = 300

# The frontend prompts for the password again when it sees this code.
REAUTH_REQUIRED_CODE = "password_confirmation_required"

# What a refusal says when the route does not word it for its own action.
REAUTH_DEFAULT_MESSAGE = "Confirm your password to delete this record."


@auth_bp.route("/confirm-password", methods=["POST"])
def confirm_password():
    """Re-authenticate the signed-in admin before a destructive action."""

    admin, error = admin_required()
    if error:
        return error

    limited = rate_limited(
        "confirm-password",
        str(admin.id),
        5,
        "Too many password confirmation attempts. Please try again later.",
    )
    if limited:
        return limited

    data = request.get_json(silent=True)
    password = str(data.get("password") or "") if isinstance(data, dict) else ""

    if not password:
        return jsonify({
            "success": False,
            "message": "Password is required"
        }), 400

    matches, needs_rehash = verify_password(admin.password, password)
    if needs_rehash:
        admin.password = hash_password(password)

    if not matches:
        session.pop("reauth_at", None)
        log_audit(
            "Admin",
            admin,
            "password confirmation failed",
            "Admin",
            admin.id,
            "Incorrect password entered for a destructive action",
        )
        db.session.commit()
        return jsonify({
            "success": False,
            "message": "Password is incorrect"
        }), 401

    session["reauth_at"] = time.time()

    return jsonify({
        "success": True,
        "message": "Password confirmed",
        "expiresInSeconds": REAUTH_MAX_AGE_SECONDS
    }), 200


def reauth_required(message=REAUTH_DEFAULT_MESSAGE):
    """Guard a destructive route behind a recent password confirmation.

    Returns ``(None, response)`` when the caller must confirm its password
    again, mirroring :func:`admin_required` so routes can chain both guards.
    A route that is not a delete passes ``message`` so the prompt names its own
    action; the code, which the frontend reads, never changes.
    """

    admin, error = admin_required()
    if error:
        return None, error

    confirmed_at = session.get("reauth_at")

    if not isinstance(confirmed_at, (int, float)) or time.time() - confirmed_at > REAUTH_MAX_AGE_SECONDS:
        session.pop("reauth_at", None)
        return None, (
            jsonify({
                "success": False,
                "code": REAUTH_REQUIRED_CODE,
                "message": message
            }),
            403
        )

    return admin, None


# ==========================================
# PASSWORD RESET OTP DELIVERY
# ==========================================

def send_password_reset_otp(admin):
    """Issues a reset code for ``admin`` and emails it to their address.

    Shared by the sign-in page's own request and by User Management, so a
    locked-out administrator is helped without anyone else seeing the code: it
    only ever reaches the account's registered address.
    """

    otp = generate_otp()

    with legacy_reset_lock, recovery_lock:
        reset_otps[admin.username] = {
            "otp": otp,
            "expires_at": otp_expiry()
        }

    message = Message(
        subject="ISU-CAMP Password Reset OTP",
        recipients=[admin.gmail]
    )

    message.body = f"""
Hello {admin.username},

You requested to reset your ISU-CAMP admin password.

Your verification code is:

{otp}

This code will expire in 10 minutes.

If you did not request this password reset, please ignore this email.

ISU-CAMP Admin System
"""

    mail.send(message)


# ==========================================
# REQUEST PASSWORD RESET OTP
# ==========================================

@auth_bp.route("/reset/request", methods=["POST"])
def request_reset():

    try:

        data = request.get_json(silent=True)
        username = str(data.get("username") or "") if isinstance(data, dict) else ""

        limited = rate_limited(
            "reset-request",
            f"{request.remote_addr or 'unknown'}:{username.strip().lower()}",
            1,
            "Too many password reset requests. Please wait before requesting another code.",
        )
        if limited:
            return limited

        if not isinstance(data, dict) or not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        if not username:
            return jsonify({
                "success": False,
                "message": "Username is required"
            }), 400

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:
            return jsonify({
                "success": False,
                "message": "Admin account not found"
            }), 404

        if not admin.gmail:
            return jsonify({
                "success": False,
                "message": "No Gmail address is registered for this account"
            }), 400

        send_password_reset_otp(admin)

        return jsonify({
            "success": True,
            "message": "Verification code sent to the registered Gmail."
        }), 200

    except Exception:

        logger.exception("Failed to send a password reset verification code")

        return jsonify({
            "success": False,
            "message": "Failed to send verification code"
        }), 500


# ==========================================
# VERIFY PASSWORD RESET OTP
# ==========================================

@auth_bp.route("/reset/verify", methods=["POST"])
def verify_reset_code():

    data = request.get_json(silent=True)
    username = str(data.get("username") or "") if isinstance(data, dict) else ""
    otp = str(data.get("code") or "") if isinstance(data, dict) else ""

    limited = rate_limited(
        "reset-verify",
        f"{request.remote_addr or 'unknown'}:{username.strip().lower()}",
        5,
        "Too many verification attempts. Please try again later.",
    )
    if limited:
        return limited

    if not username or not otp:
        return jsonify({"success": False, "message": "Username and verification code are required"}), 400

    verdict = legacy_reset_code_verdict(username, otp)
    if verdict:
        return verdict

    return jsonify({"success": True, "message": "Verification code accepted"}), 200


def legacy_reset_code_verdict(username, otp, consume=False):
    """A refusal for a legacy reset code, or None when it is good.

    Read, judged and (with ``consume``) removed as one step under
    ``recovery_lock``, so an expired entry dropped here is the one that was
    read, never a newer code issued meanwhile.
    """

    with recovery_lock:
        reset = reset_otps.get(username)
        if not reset or datetime.utcnow() > reset["expires_at"]:
            reset_otps.pop(username, None)
            return jsonify({"success": False, "message": "Verification code has expired"}), 400
        if not secrets.compare_digest(str(reset["otp"]), str(otp)):
            return jsonify({"success": False, "message": "Invalid verification code"}), 400
        if consume:
            del reset_otps[username]
    return None


# ==========================================
# RESET PASSWORD
# ==========================================

@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():

    try:

        data = request.get_json(silent=True)
        username = str(data.get("username") or "") if isinstance(data, dict) else ""

        limited = rate_limited(
            "reset-password",
            f"{request.remote_addr or 'unknown'}:{username.strip().lower()}",
            5,
            "Too many password reset attempts. Please try again later.",
        )
        if limited:
            return limited

        if not isinstance(data, dict) or not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        otp = data.get("code")
        password = data.get("password")

        if not username or not otp or not password:
            return jsonify({
                "success": False,
                "message": "Username, verification code, and new password are required"
            }), 400

        weakness = first_password_issue(password)
        if weakness:
            return jsonify({
                "success": False,
                "message": weakness
            }), 400

        # Checked first so a wrong code is refused before the slow hash, and
        # checked again, and spent, once the hash is done: the code may have
        # been replaced or redeemed while it ran.
        verdict = legacy_reset_code_verdict(username, otp)
        if verdict:
            return verdict

        password_hash = hash_password(password)

        with legacy_reset_lock:
            admin = Admin.query.filter_by(
                username=username
            ).first()

            if not admin:

                with recovery_lock:
                    reset_otps.pop(username, None)

                return jsonify({
                    "success": False,
                    "message": "Admin account not found"
                }), 404

            verdict = legacy_reset_code_verdict(username, otp, consume=True)
            if verdict:
                return verdict

            admin.password = password_hash

            db.session.commit()

        return jsonify({
            "success": True,
            "message": "Password reset successful"
        }), 200

    except Exception:

        logger.exception("Password reset failed")

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Password reset failed"
        }), 500


# ==========================================
# ACCOUNT RECOVERY BY EMAIL
# ==========================================
#
# The forgot-password and forgot-username pages. The admin gives an email, not
# a username, so nothing here may reveal whether that email has an account: an
# address with none is handled with the same stored state, the same responses
# and the same attempt counting as one that does. The only difference is that
# no email is sent for it.

RECOVERY_PURPOSES = ("password", "username")
RECOVERY_RESEND_SECONDS = RATE_LIMIT_WINDOW_SECONDS

# Wrong codes one account may guess before recovery is restricted. Counted
# against the account, not against the code: see the subject section below.
RECOVERY_ATTEMPT_LIMIT = 5
RECOVERY_REQUEST_MESSAGE = "If an account exists for this email, a code has been sent."

# Rate limits, per minute. Requests are limited per address as the resend
# cooldown and per client across addresses so the form cannot be used to flood
# inboxes. Guesses are limited per address and per client; the per-code attempt
# limit is what actually stops guessing, this only slows a flood of requests.
RECOVERY_REQUEST_LIMIT_PER_IP = 10
RECOVERY_GUESS_LIMIT_PER_EMAIL = 10
RECOVERY_GUESS_LIMIT_PER_IP = 30

# Expired entries stay for a while so a late attempt is told its code expired
# rather than that it never existed; after that they are swept.
RECOVERY_RETAIN_EXPIRED_SECONDS = 3600

# Every address asked about gets a stored entry, real account or not, so the
# number of entries is capped; past it the oldest go first, whichever kind they
# are, so being evicted cannot tell an attacker which addresses have accounts.
# Entries made by /request live in ``reset_otps`` under this cap. A guess for an
# address with no entry makes one too, but in ``guessed_recovery_entries`` under
# its own cap, so guessing at addresses nobody asked about can only push out
# other such guesses, never a code that was really requested.
RECOVERY_MAX_ENTRIES = 5000
RECOVERY_MAX_GUESSED_ENTRIES = 5000
guessed_recovery_entries = {}

# The width of the admin.gmail column: no stored address is longer, so a longer
# one cannot belong to an account. Checked before anything is keyed on it.
EMAIL_MAX_LENGTH = 255
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# A code is exactly six ASCII digits. Anything else is a wrong guess.
RECOVERY_CODE_PATTERN = re.compile(r"[0-9]{6}")
# What a codeless (phantom) entry is compared against, so a guess costs the same
# whether or not the entry holds a code.
PHANTOM_CODE = "000000"

# Check, count and decide happen under this lock: the stored code, the
# subject's attempt counters and the verdict are one decision, and guesses
# arriving together must not each see a budget the others are about to spend.
#
# It is therefore held across the counter's own database calls - a locked read,
# an update and a commit - which is deliberate, and the reason that section is
# kept to exactly those statements. It is never held across a mail send, a
# password hash, or the account lookup.
#
# Within one process this lock is what serializes recovery; across processes
# the row lock in recovery_attempt_row does the same job, so a deployment with
# several workers counts once per guess rather than once per worker.
recovery_lock = threading.Lock()


def run_in_background(work):
    """Runs ``work`` off the request thread so a slow mail server cannot tell
    a caller which emails have accounts."""

    app = current_app._get_current_object()

    def run():
        with app.app_context():
            work()

    threading.Thread(target=run, daemon=True).start()


def admins_with_email(email):
    """At most two administrators who hold ``email`` as either of their addresses.

    The alternative address counts, which is the whole point of registering
    one: recovery accepts either. Two is enough to know the address is
    ambiguous. Nothing in the database makes an address unique, so the caller
    has to cope with more than one.
    """
    return admins_holding_email(email, limit=2)


def find_recovery_admin(email):
    """The one active administrator ``email`` belongs to, or None.

    None also covers a deactivated account and an address shared by several
    accounts, so neither can be recovered into or have a username disclosed.
    """
    matches = admins_with_email(email)
    if len(matches) == 1 and matches[0].is_active:
        return matches[0]
    return None


# ==========================================
# WHAT RECOVERY REMEMBERS BETWEEN REQUESTS
# ==========================================
#
# Two account-scoped limits, both persistent, both measured over the same
# fifteen-minute window:
#
#   * at most RECOVERY_REQUEST_LIMIT codes may be asked for, so the form cannot
#     be used to mail somebody repeatedly, and
#   * at most RECOVERY_ATTEMPT_LIMIT wrong codes may be guessed, after which
#     recovery is restricted for RECOVERY_RESTRICTION_SECONDS.
#
# The counts belong to a *subject* rather than to a code. A code used to carry
# its own budget, which meant asking for a new one restored it: five guesses a
# code and a code a minute is five guesses a minute, indefinitely, which is not
# a limit. They are also not per address - an account's two addresses are one
# account, and guessing at each in turn must not buy two budgets - and not per
# purpose, since the forgot-password and forgot-username pages verify the same
# inbox.
#
# They live in the database because an in-memory counter is a limit an attacker
# can wait out: a restart cleared every one of them, and a second worker ran a
# second set alongside the first. The codes themselves stay in memory, so a
# restart still invalidates outstanding codes - losing those costs an attacker
# nothing, which is exactly why they are the part that may be lost.

# The window both limits are measured over, and how long a restriction lasts.
# One number for all three so the rule is sayable in a sentence: five wrong
# codes in fifteen minutes, then fifteen minutes off.
RECOVERY_WINDOW_SECONDS = 900
RECOVERY_RESTRICTION_SECONDS = 900

# Codes one subject may ask for inside the window. Three is enough for a
# mistyped address and a lost email without becoming a way to fill an inbox.
RECOVERY_REQUEST_LIMIT = 3

# The frontend reads these codes, not the message text. A restriction is about
# the account and lasts minutes; a rate limit is about how fast this client is
# going and lasts seconds, so they must not look the same.
RECOVERY_RESTRICTED_CODE = "recovery_restricted"
RATE_LIMITED_CODE = "rate_limited"

RECOVERY_RESTRICTED_MESSAGE = (
    "Too many attempts. Account recovery is locked for a short while. "
    "Please try again later."
)
RECOVERY_REQUEST_LIMIT_MESSAGE = (
    "Too many codes have been requested for this email. Please try again later."
)

# Rows that remember nothing are deleted, and the sweep runs at most this often
# so a flood of requests does not turn into a flood of DELETEs.
RECOVERY_SWEEP_INTERVAL_SECONDS = 900
recovery_swept_at = None


def utc_now():
    return datetime.now(timezone.utc)


def as_utc(value):
    """A stored timestamp as an aware UTC one.

    SQLite hands back a naive datetime even for a column declared with a
    timezone, so a value read back from the database cannot be compared with an
    aware one without this. Naive values are read as UTC, which is what every
    writer here stores.
    """

    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def recovery_digest(email):
    """``email`` as a keyed digest, for a subject that has no account.

    Keyed with SECRET_KEY rather than hashed plainly. Without a key this table
    would be a list of every address anybody has typed into Forgot Password -
    addresses that by definition belong to people with no account here - and an
    email address is guessable enough that a bare digest is a dictionary away
    from the address itself.

    Rotating SECRET_KEY abandons these counters. That is acceptable: rotating
    it already signs every session out, and the counters are at most fifteen
    minutes of history.
    """

    key = str(current_app.config.get("SECRET_KEY") or "").encode("utf-8")
    return hmac.new(key, email.encode("utf-8"), hashlib.sha256).hexdigest()


def recovery_identity(email):
    """``(subject, admin)`` for a submitted address, from one lookup.

    The subject is who the counters belong to: ``admin:<id>`` when the address
    belongs to exactly one account, so that account's primary and alternative
    addresses share one budget, and ``email:<digest>`` otherwise. Note that a
    *deactivated* account still gives its own subject - it cannot be recovered
    into, but its two addresses are still one thing being guessed at.

    The admin is who may be recovered, which is None for a deactivated account
    and for an address several accounts share, exactly as
    :func:`find_recovery_admin` decides it.
    """

    matches = admins_with_email(email)
    if len(matches) == 1:
        admin = matches[0] if matches[0].is_active else None
        return f"admin:{matches[0].id}", admin
    return f"email:{recovery_digest(email)}", None


def sweep_recovery_attempts():
    """Deletes rows that no longer remember anything, at most once an interval.

    A row is touched on every request and every guess, so one untouched for
    longer than the window plus a whole restriction holds a failure count that
    has already decayed and a restriction that has already lifted. Deleting it
    changes no verdict, and it is what keeps a flood of invented addresses from
    growing this table past the addresses actually seen in the last few
    minutes.
    """

    global recovery_swept_at

    now = time.monotonic()
    if recovery_swept_at is not None and 0 <= now - recovery_swept_at < RECOVERY_SWEEP_INTERVAL_SECONDS:
        return
    recovery_swept_at = now

    cutoff = utc_now() - timedelta(seconds=RECOVERY_WINDOW_SECONDS + RECOVERY_RESTRICTION_SECONDS)
    try:
        (
            RecoveryAttempt.query
            .filter(RecoveryAttempt.updated_at < cutoff)
            .filter(db.or_(
                RecoveryAttempt.restricted_until.is_(None),
                RecoveryAttempt.restricted_until <= utc_now(),
            ))
            .delete(synchronize_session=False)
        )
    except Exception:
        # Housekeeping. A recovery attempt must not fail because the tidying
        # did, and the next request tries again.
        db.session.rollback()


def recovery_attempt_row(subject):
    """The subject's row, created if new, locked until this request commits.

    ``FOR UPDATE`` is what makes the counts mean anything under concurrency:
    guesses sent together queue here instead of each reading a budget that the
    others are about to spend. The lock is released by the commit or rollback
    at the end of the request, so every route loads this *before* it writes
    anything else and holds it to the end.

    Two requests racing to create the same row is normal - an address nobody
    has asked about before is the common case - so the insert is attempted in a
    savepoint and the loser reads the winner's row.
    """

    row = db.session.get(RecoveryAttempt, subject, with_for_update=True)
    if row is not None:
        settle_recovery_row(row)
        return row

    try:
        with db.session.begin_nested():
            row = RecoveryAttempt(subject=subject, failures=0, requested_at=[])
            db.session.add(row)
    except IntegrityError:
        row = db.session.get(RecoveryAttempt, subject, with_for_update=True)
        if row is None:
            # Lost the insert and cannot see the winner's row: without a
            # counter there is nothing to judge against, so refuse rather than
            # let the request through uncounted.
            raise
        settle_recovery_row(row)
    return row


def settle_recovery_row(row):
    """Clears what the clock has already undone.

    Done on read rather than by a job, so a restriction lifts and a failure
    count decays at the moment they are next looked at, whether or not anything
    has swept in the meantime.

    A lifted restriction takes the failures with it. Leaving them at the limit
    would restrict the subject again on its very next mistake, for ever, which
    is a permanent lockout wearing a fifteen-minute label.
    """

    now = utc_now()
    restricted_until = as_utc(row.restricted_until)

    if restricted_until is not None and now >= restricted_until:
        row.restricted_until = None
        row.failures = 0
        row.last_failure_at = None
        return

    if restricted_until is not None:
        return

    last_failure = as_utc(row.last_failure_at)
    if last_failure is not None and (now - last_failure).total_seconds() >= RECOVERY_WINDOW_SECONDS:
        # The window passed with no new failure. Counting a mistake made an
        # hour ago against the next one would make five lifetime slips enough
        # to lock an address out of its own account.
        row.failures = 0
        row.last_failure_at = None


def recovery_restriction_seconds(row):
    """Whole seconds until this subject may try again, or 0 when it may now."""

    restricted_until = as_utc(row.restricted_until)
    if restricted_until is None:
        return 0
    remaining = (restricted_until - utc_now()).total_seconds()
    return max(1, math.ceil(remaining)) if remaining > 0 else 0


def recovery_request_times(row):
    """The stored request times still inside the window, oldest first.

    Anything unparseable is dropped rather than raised on: the column is
    written only by the function below, and a value that is not a timestamp
    cannot be weighed against one.
    """

    cutoff = utc_now() - timedelta(seconds=RECOVERY_WINDOW_SECONDS)
    times = []
    for value in row.requested_at or []:
        try:
            moment = as_utc(datetime.fromisoformat(str(value)))
        except (TypeError, ValueError):
            continue
        if moment > cutoff:
            times.append(moment)
    return sorted(times)


def recovery_request_wait(row):
    """Whole seconds until another code may be asked for, or 0 when one may.

    The window slides: the wait is until the oldest of the requests that fill
    the cap leaves it, not until some fixed period restarts. A fixed window
    would let the cap be spent twice in a moment by straddling its boundary.
    """

    times = recovery_request_times(row)
    if len(times) < RECOVERY_REQUEST_LIMIT:
        return 0
    oldest = times[-RECOVERY_REQUEST_LIMIT]
    remaining = RECOVERY_WINDOW_SECONDS - (utc_now() - oldest).total_seconds()
    return max(1, math.ceil(remaining))


def record_recovery_request(row):
    """Counts one issued code against the window.

    Assigns a new list: a JSON column does not notice one mutated in place, so
    appending would be a write the session never sends.
    """

    times = recovery_request_times(row) + [utc_now()]
    row.requested_at = [moment.isoformat() for moment in times[-RECOVERY_REQUEST_LIMIT:]]
    row.updated_at = utc_now()


def record_recovery_failure(row):
    """Spends one attempt. Returns the restriction in seconds, or 0.

    The limit is reached *on* this failure, not after it: the fifth wrong code
    is told recovery is restricted, rather than being told to request another
    one it could then spend five more guesses against.
    """

    now = utc_now()
    row.failures = (row.failures or 0) + 1
    row.last_failure_at = now
    row.updated_at = now

    if row.failures >= RECOVERY_ATTEMPT_LIMIT:
        row.restricted_until = now + timedelta(seconds=RECOVERY_RESTRICTION_SECONDS)
        return RECOVERY_RESTRICTION_SECONDS
    return 0


def recovery_attempts_remaining(row):
    return max(0, RECOVERY_ATTEMPT_LIMIT - (row.failures or 0))


def clear_recovery_failures(row):
    """Forgets the wrong guesses, because the right code has just arrived.

    A correct code proves the person reading the inbox is the one asking, which
    is the whole thing the attempt limit exists to establish - so holding four
    earlier typos against them afterwards protects nothing. This is the answer
    to "does a successful username recovery clear the counters": it clears the
    failures, and deliberately not the request window, which is about how much
    mail the form may send and is not excused by a success.
    """

    row.failures = 0
    row.last_failure_at = None
    row.updated_at = utc_now()


def recovery_restricted_response(seconds):
    """The 429 every route answers with while a subject is restricted."""

    response = jsonify({
        "success": False,
        "code": RECOVERY_RESTRICTED_CODE,
        "message": RECOVERY_RESTRICTED_MESSAGE,
    })
    # Whole seconds: the header is read with parseInt, and a fractional value
    # would be read as the integer before the point or not at all.
    response.headers["Retry-After"] = str(max(1, int(seconds)))
    return response, 429


def recovery_request_limited_response(seconds):
    """The 429 for a subject that has asked for its codes too often.

    Account-scoped like the restriction, and carries the same code, because to
    the caller it is the same kind of answer: this account's recovery is closed
    for a while, come back later. A flood limit says something different - that
    this client is going too fast - and keeps its own code.
    """

    response = jsonify({
        "success": False,
        "code": RECOVERY_RESTRICTED_CODE,
        "message": RECOVERY_REQUEST_LIMIT_MESSAGE,
    })
    response.headers["Retry-After"] = str(max(1, int(seconds)))
    return response, 429


def recovery_key(purpose, email):
    return (purpose, email)


def sweep_recovery_codes():
    """Drops long-expired entries; the caller holds ``recovery_lock``."""
    cutoff = datetime.utcnow() - timedelta(seconds=RECOVERY_RETAIN_EXPIRED_SECONDS)
    for pool in (reset_otps, guessed_recovery_entries):
        for key in [k for k, entry in list(pool.items()) if isinstance(k, tuple) and entry["expires_at"] < cutoff]:
            pool.pop(key, None)


def find_recovery_entry(key):
    """The entry for ``key`` from either pool, or None; the caller holds the lock.

    A guessed entry only exists while no requested one does, so the order is
    not observable.
    """
    entry = reset_otps.get(key)
    return entry if entry is not None else guessed_recovery_entries.get(key)


def store_recovery_entry(pool, cap, key, entry):
    """Stores ``entry`` in ``pool`` as the newest, evicting its oldest past ``cap``.

    The caller holds ``recovery_lock``. Only the entries of ``pool`` are
    counted or evicted, and the oldest goes first whatever kind it is.
    """
    pool.pop(key, None)
    pool[key] = entry
    if len(pool) <= cap:
        return
    sweep_recovery_codes()
    excess = sum(1 for k in list(pool) if isinstance(k, tuple)) - cap
    for oldest in [k for k in list(pool) if isinstance(k, tuple)][:max(excess, 0)]:
        pool.pop(oldest, None)


def new_recovery_entry(otp=None, admin=None):
    """One issued code, or a codeless stand-in for an address with no account.

    No attempt count: the budget belongs to the subject and lives in the
    database, so there is nothing per code to reset. That is the whole point -
    an entry that carried its own budget made asking for a new code the way to
    get more guesses.
    """

    return {
        "otp": otp,
        "admin_id": admin.id if admin else None,
        "expires_at": otp_expiry(),
    }


def issue_recovery_code(purpose, email, admin):
    """Stores a fresh code state for ``(purpose, email)`` and returns the code.

    Replaces any earlier code, which is what makes a resend invalidate the one
    before it. It restores no attempts: the budget is the subject's and is
    untouched here, so a resend buys a new code and not new guesses. With no
    ``admin`` the entry holds no code, but still expires and is guessed against
    like one that does, so asking about an unknown address changes nothing
    visible.
    """
    otp = generate_otp() if admin else None
    with recovery_lock:
        sweep_recovery_codes()
        key = recovery_key(purpose, email)
        guessed_recovery_entries.pop(key, None)
        store_recovery_entry(reset_otps, RECOVERY_MAX_ENTRIES, key, new_recovery_entry(otp, admin))
    return otp


def send_recovery_otp(admin, purpose, otp, address):
    if purpose == "username":
        subject = "ISU-CAMP Username Recovery Code"
        body = f"""
Hello,

You asked to recover your ISU-CAMP admin username.

Your verification code is:

{otp}

This code will expire in {OTP_LIFETIME_SECONDS // 60} minutes.

If you did not make this request, please ignore this email.

ISU-CAMP Admin System
"""
    else:
        subject = "ISU-CAMP Password Reset Code"
        body = f"""
Hello {admin.username},

You requested to reset your ISU-CAMP admin password.

Your verification code is:

{otp}

This code will expire in {OTP_LIFETIME_SECONDS // 60} minutes.

If you did not request this password reset, please ignore this email.

ISU-CAMP Admin System
"""

    # The address that was typed, not the account's primary one. An
    # administrator who asks from their alternative address gets the code
    # there; sending to the primary instead would tell whoever typed the
    # alternative that the two belong together, and would mail a code to an
    # inbox nobody asked about.
    message = Message(subject=subject, recipients=[address])
    message.body = body

    def deliver():
        try:
            mail.send(message)
        except Exception:
            # The caller was already told "if an account exists", so a failure
            # here can only be reported to the operator.
            logger.exception("Could not send a recovery email")

    run_in_background(deliver)


def recovery_error(code, message, attempts_remaining=None):
    body = {"success": False, "code": code, "message": message}
    if attempts_remaining is not None:
        body["attemptsRemaining"] = attempts_remaining
    return jsonify(body), 400


def recovery_bad_request(message):
    return jsonify({"success": False, "message": message}), 400


def recovery_failure(error):
    logger.exception("Account recovery failed", exc_info=error)
    db.session.rollback()
    return jsonify({
        "success": False,
        "message": "Account recovery failed. Please try again."
    }), 500


def recovery_email(data):
    """The normalised email from a request body, or '' when it is unusable.

    Longer than a stored address can be counts as unusable, and is measured as
    submitted, before anything is lowercased or kept, so an oversized value
    costs nothing. Lowercasing can lengthen a character, so the result may be
    a little longer than the cap.
    """
    value = data.get("email") if isinstance(data, dict) else None
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if len(value) > EMAIL_MAX_LENGTH:
        return ""
    return value.lower()


def recovery_code_matches(entry, code):
    """True when ``code`` is the one stored in ``entry``.

    A malformed code is compared as nothing at all, and a codeless entry
    against a placeholder, so every input takes the same steps for any entry.
    """
    submitted = code.encode() if RECOVERY_CODE_PATTERN.fullmatch(code) else b""
    stored = entry["otp"] if entry["otp"] is not None else PHANTOM_CODE
    digits_match = secrets.compare_digest(stored.encode(), submitted)
    return digits_match and entry["otp"] is not None


def authorize_recovery_request(email):
    """Counts one code request against the subject, or refuses it.

    Returns ``(admin, None)`` when a code may be issued - having recorded that
    it was - or ``(None, response)`` with what to send instead. ``admin`` is
    who the code is for, which is None for an address with no account, so the
    caller does not look the address up a second time.

    Both account-scoped limits are checked here: a restriction earned by
    guessing closes requesting too, because otherwise the way to sit out a
    restriction would be to keep mailing yourself codes until it lifted.

    Recorded and committed before the code is issued, so a crash between the
    two costs a request rather than leaving a code that nothing counted.
    """

    subject, admin = recovery_identity(email)

    with recovery_lock:
        sweep_recovery_attempts()
        row = recovery_attempt_row(subject)

        restriction = recovery_restriction_seconds(row)
        if restriction:
            db.session.commit()
            return None, recovery_restricted_response(restriction)

        wait = recovery_request_wait(row)
        if wait:
            # Nothing is issued and nothing is sent: the point of the cap is
            # that the inbox stops receiving.
            db.session.commit()
            return None, recovery_request_limited_response(wait)

        record_recovery_request(row)
        db.session.commit()
    return admin, None


def check_recovery_code(purpose, email, code):
    """Judges a submitted code, spending one of the subject's attempts if wrong.

    Returns ``(admin, None)`` when it is right, or ``(None, response)`` with the
    contract's refusal.

    The order is restriction, then expiry, then correctness. A restriction is
    checked before the code is even looked at, so it refuses the right code as
    well as a wrong one - a restriction the correct code walked through would
    only ever restrict people who had lost their code. There is no "exhausted"
    state left: the attempt that reaches the limit is answered with the
    restriction itself, rather than being told to request a new code as a way
    out of having run out of guesses.

    A correct code clears the failures; see
    :func:`clear_recovery_failures`. An address with no account, or no code
    ever requested, is judged against a codeless entry and fails the same way,
    spending the same attempt.

    The account and the subject are looked up first, for every address, outside
    the lock. Everything that decides the verdict then happens inside it, so
    guesses sent together cannot each see budget left, and a right guess cannot
    be accepted after the wrong one that spent the last attempt.
    """

    key = recovery_key(purpose, email)
    subject, admin = recovery_identity(email)

    with recovery_lock:
        sweep_recovery_attempts()
        row = recovery_attempt_row(subject)

        restriction = recovery_restriction_seconds(row)
        if restriction:
            db.session.commit()
            return None, recovery_restricted_response(restriction)

        entry = find_recovery_entry(key)
        if entry is None:
            sweep_recovery_codes()
            entry = new_recovery_entry()
            store_recovery_entry(guessed_recovery_entries, RECOVERY_MAX_GUESSED_ENTRIES, key, entry)

        if datetime.utcnow() >= entry["expires_at"]:
            db.session.commit()
            return None, recovery_error("code_expired", "This code has expired. Request a new one.")

        if recovery_code_matches(entry, code) and admin is not None and admin.id == entry["admin_id"]:
            clear_recovery_failures(row)
            db.session.commit()
            return admin, None

        restriction = record_recovery_failure(row)
        remaining = recovery_attempts_remaining(row)
        db.session.commit()

    if restriction:
        return None, recovery_restricted_response(restriction)
    return None, recovery_error("invalid_code", "Incorrect verification code", remaining)


def claim_recovery_code(purpose, email, code, admin):
    """Takes the code out of the store so exactly one request can redeem it.

    Returns ``(entry, None)`` to the one request that gets it, or
    ``(None, response)`` when the code is no longer good: already redeemed,
    replaced by a newer one, used up or expired since this request checked it.
    Nothing is counted here; the guess was already judged right.
    """
    key = recovery_key(purpose, email)
    subject, _ = recovery_identity(email)
    with recovery_lock:
        # The check committed and released the subject's row, and the password
        # was hashed since, so wrong guesses may have restricted the subject in
        # between. Re-read it: a restriction refuses the right code here too.
        # Locked again from here, the row is released by the password's commit.
        row = recovery_attempt_row(subject)
        restriction = recovery_restriction_seconds(row)
        if restriction:
            db.session.commit()
            return None, recovery_restricted_response(restriction)
        entry = reset_otps.get(key)
        if entry is None or entry["otp"] is None or entry["admin_id"] != admin.id or not recovery_code_matches(entry, code):
            return None, recovery_error("code_exhausted", "This code can no longer be used. Request a new one.", 0)
        if datetime.utcnow() >= entry["expires_at"]:
            return None, recovery_error("code_expired", "This code has expired. Request a new one.")
        del reset_otps[key]
        return entry, None


def recovery_guess_limit(scope, email):
    """Limits guesses per client and per client and address.

    An address that is not a usable email is only counted against the client:
    the route refuses it next, and it must not become a limiter key.
    """
    client = request.remote_addr or "unknown"
    limited = rate_limited(
        f"{scope}-ip",
        client,
        RECOVERY_GUESS_LIMIT_PER_IP,
        "Too many attempts. Please try again later.",
    )
    if limited or not EMAIL_PATTERN.match(email):
        return limited
    return rate_limited(
        scope,
        f"{client}:{email}",
        RECOVERY_GUESS_LIMIT_PER_EMAIL,
        "Too many attempts. Please try again later.",
    )


@auth_bp.route("/recovery/request", methods=["POST"])
def recovery_request():
    try:
        data = request.get_json(silent=True)
        email = recovery_email(data)
        client = request.remote_addr or "unknown"

        limited = rate_limited(
            "recovery-request-ip",
            client,
            RECOVERY_REQUEST_LIMIT_PER_IP,
            "Too many recovery requests. Please try again later.",
        )
        if limited:
            return limited

        # Before the per-address limit, so a malformed or oversized address
        # never becomes a key.
        if not EMAIL_PATTERN.match(email):
            return recovery_bad_request("Enter a valid email address.")

        limited = rate_limited(
            "recovery-request",
            f"{client}:{email}",
            1,
            "Please wait before requesting another code.",
        )
        if limited:
            return limited

        purpose = data.get("purpose") if isinstance(data, dict) else None
        if purpose not in RECOVERY_PURPOSES:
            return recovery_bad_request("Choose whether to recover a password or a username.")

        admin, refused = authorize_recovery_request(email)
        if refused:
            return refused

        otp = issue_recovery_code(purpose, email, admin)
        if admin:
            send_recovery_otp(admin, purpose, otp, email)

        return jsonify({
            "success": True,
            "message": RECOVERY_REQUEST_MESSAGE,
            "expiresInSeconds": OTP_LIFETIME_SECONDS,
            "resendAfterSeconds": RECOVERY_RESEND_SECONDS,
        }), 200

    except Exception as e:
        return recovery_failure(e)


@auth_bp.route("/recovery/verify", methods=["POST"])
def recovery_verify():
    try:
        data = request.get_json(silent=True)
        email = recovery_email(data)

        limited = recovery_guess_limit("recovery-verify", email)
        if limited:
            return limited

        purpose = data.get("purpose") if isinstance(data, dict) else None
        code = data.get("code") if isinstance(data, dict) else None
        if not EMAIL_PATTERN.match(email) or purpose not in RECOVERY_PURPOSES or not isinstance(code, str) or not code:
            return recovery_bad_request("Email, purpose and verification code are required.")

        admin, refusal = check_recovery_code(purpose, email, code)
        if refusal:
            return refusal

        return jsonify({"success": True, "username": admin.username}), 200

    except Exception as e:
        return recovery_failure(e)


@auth_bp.route("/recovery/reset-password", methods=["POST"])
def recovery_reset_password():
    try:
        data = request.get_json(silent=True)
        email = recovery_email(data)

        limited = recovery_guess_limit("recovery-reset", email)
        if limited:
            return limited

        code = data.get("code") if isinstance(data, dict) else None
        password = data.get("password") if isinstance(data, dict) else None
        if not EMAIL_PATTERN.match(email) or not isinstance(code, str) or not code or not isinstance(password, str) or not password:
            return recovery_bad_request("Email, verification code and new password are required.")

        # The code first, so the password rules cannot be probed without one,
        # and so a weak password is refused without having spent the code.
        admin, refusal = check_recovery_code("password", email, code)
        if refusal:
            return refusal

        weakness = first_password_issue(password)
        if weakness:
            return recovery_error("weak_password", weakness)

        # Hashed before the claim only because it is slow and changes nothing.
        password_hash = hash_password(password)

        # The code is single-use: whichever request claims it first redeems it,
        # and a request that checked it at the same moment is refused here,
        # before anything is written.
        _, refusal = claim_recovery_code("password", email, code, admin)
        if refusal:
            return refusal

        # Read before the commit: committing expires the row, so reading it
        # afterwards is another query, and a failure there would report an
        # error for a password that has already changed.
        username = admin.username

        # The code is spent for good, even if this write fails: the admin asks
        # for a new one, and nothing can bring an old one back.
        admin.password = password_hash
        log_audit(
            "System", admin, "password reset", "Admin", admin.id,
            "Password reset by email verification code"
        )
        db.session.commit()

        return jsonify({"success": True, "username": username}), 200

    except Exception as e:
        return recovery_failure(e)
