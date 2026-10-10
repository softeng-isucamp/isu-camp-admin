from collections import defaultdict, deque
import math
import re
import threading
import time

from flask import Blueprint, current_app, request, jsonify, session
from flask_mail import Message
from dotenv import load_dotenv
from sqlalchemy import func

from extensions import db, mail
from services.audit import log_audit
from services.password_rules import first_password_issue
from services.security import (
    burn_password_comparison,
    hash_password,
    verify_password,
)

import secrets
from datetime import datetime, timedelta

load_dotenv()


# ==========================================
# Authentication Blueprint
# ==========================================

auth_bp = Blueprint(
    "auth",
    __name__,
    url_prefix="/api"
)


# ==========================================
# Temporary Password Reset OTP Storage
# ==========================================

# Keyed by username for the legacy /api/reset/* routes and the admin-triggered
# reset, and by (purpose, email) for /api/recovery/*, so the two never collide.
reset_otps = {}

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
    response = jsonify({"success": False, "message": message})
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

    @property
    def is_active(self):
        return (self.status or "active") == "active"

    @property
    def is_superadmin(self):
        return (self.role or "admin") == "superadmin"

    def to_profile(self):
        """The account as My Profile reads it.

        Not wrapped in the usual success envelope: the frontend parses this
        response body directly against its own schema (services/profile.ts),
        so the fields sit at the top level.
        """
        return {
            "id": str(self.id),
            "username": self.username,
            "email": self.gmail or "",
            "role": "superadmin" if self.is_superadmin else "admin",
        }


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

        session["admin_id"] = admin.id
        session["admin_username"] = admin.username
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

    except Exception as e:

        print("LOGIN ERROR:", e)

        return jsonify({
            "success": False,
            "message": "Login failed",
            "error": str(e)
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

    except Exception as e:

        print("PASSWORD RESET EMAIL ERROR:", e)

        return jsonify({
            "success": False,
            "message": "Failed to send verification code",
            "error": str(e)
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

    reset = reset_otps.get(username)
    if not reset or datetime.utcnow() > reset["expires_at"]:
        reset_otps.pop(username, None)
        return jsonify({"success": False, "message": "Verification code has expired"}), 400

    if not secrets.compare_digest(str(reset["otp"]), otp):
        return jsonify({"success": False, "message": "Invalid verification code"}), 400

    return jsonify({"success": True, "message": "Verification code accepted"}), 200


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

        reset = reset_otps.get(username)

        if not reset or datetime.utcnow() > reset["expires_at"]:

            reset_otps.pop(username, None)

            return jsonify({
                "success": False,
                "message": "Verification code has expired"
            }), 400

        if not secrets.compare_digest(
            str(reset["otp"]),
            str(otp)
        ):
            return jsonify({
                "success": False,
                "message": "Invalid verification code"
            }), 400

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:

            reset_otps.pop(username, None)

            return jsonify({
                "success": False,
                "message": "Admin account not found"
            }), 404

        admin.password = hash_password(password)

        db.session.commit()

        reset_otps.pop(username, None)

        return jsonify({
            "success": True,
            "message": "Password reset successful"
        }), 200

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Password reset failed",
            "error": str(e)
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

# Check, count and decide on a code entry happen under this lock, and so does
# every change to the recovery entries. It is never held across a database call
# or a mail send.
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
    """At most two administrators whose address is ``email``, ignoring case.

    Two is enough to know the address is ambiguous. Nothing in the database
    makes an address unique, so the caller has to cope with more than one.
    """
    return Admin.query.filter(func.lower(Admin.gmail) == email).limit(2).all()


def find_recovery_admin(email):
    """The one active administrator ``email`` belongs to, or None.

    None also covers a deactivated account and an address shared by several
    accounts, so neither can be recovered into or have a username disclosed.
    """
    matches = admins_with_email(email)
    if len(matches) == 1 and matches[0].is_active:
        return matches[0]
    return None


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
    return {
        "otp": otp,
        "admin_id": admin.id if admin else None,
        "expires_at": otp_expiry(),
        "attempts": 0,
    }


def issue_recovery_code(purpose, email, admin):
    """Stores a fresh code state for ``(purpose, email)`` and returns the code.

    Replaces any earlier code and restores the full attempt budget. With no
    ``admin`` the entry holds no code, but still counts guesses and expires like
    one that does, so asking about an unknown address changes nothing visible.
    """
    otp = generate_otp() if admin else None
    with recovery_lock:
        sweep_recovery_codes()
        key = recovery_key(purpose, email)
        guessed_recovery_entries.pop(key, None)
        store_recovery_entry(reset_otps, RECOVERY_MAX_ENTRIES, key, new_recovery_entry(otp, admin))
    return otp


def send_recovery_otp(admin, purpose, otp):
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

    message = Message(subject=subject, recipients=[admin.gmail])
    message.body = body

    def deliver():
        try:
            mail.send(message)
        except Exception as e:
            # The caller was already told "if an account exists", so a failure
            # here can only be reported to the operator.
            print("RECOVERY EMAIL ERROR:", e)

    run_in_background(deliver)


def recovery_error(code, message, attempts_remaining=None):
    body = {"success": False, "code": code, "message": message}
    if attempts_remaining is not None:
        body["attemptsRemaining"] = attempts_remaining
    return jsonify(body), 400


def recovery_bad_request(message):
    return jsonify({"success": False, "message": message}), 400


def recovery_failure(error):
    print("RECOVERY ERROR:", error)
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


def check_recovery_code(purpose, email, code):
    """Judges a submitted code against the one issued for ``(purpose, email)``.

    Returns ``(admin, None)`` when it is right, or ``(None, response)`` with the
    contract's refusal. Checks expiry, then exhaustion, then correctness; each
    wrong guess spends one of the attempts and the last one kills the code, so
    the right code is refused from then on. An address with no account, or no
    code ever requested, is judged against a codeless entry and fails the same
    way. A correct code does not consume anything.

    The account is looked up first, for every address, outside the lock. The
    entry is then read, counted and decided in one step under the lock, so
    guesses sent together cannot each see budget left, and a right guess cannot
    be accepted after the wrong one that used the last attempt.
    """
    key = recovery_key(purpose, email)
    admin = find_recovery_admin(email)

    with recovery_lock:
        entry = find_recovery_entry(key)
        if entry is None:
            sweep_recovery_codes()
            entry = new_recovery_entry()
            store_recovery_entry(guessed_recovery_entries, RECOVERY_MAX_GUESSED_ENTRIES, key, entry)

        if datetime.utcnow() >= entry["expires_at"]:
            return None, recovery_error("code_expired", "This code has expired. Request a new one.")

        if entry["attempts"] >= RECOVERY_ATTEMPT_LIMIT:
            return None, recovery_error("code_exhausted", "Too many incorrect codes. Request a new one.", 0)

        if recovery_code_matches(entry, code) and admin is not None and admin.id == entry["admin_id"]:
            return admin, None

        entry["attempts"] += 1
        remaining = RECOVERY_ATTEMPT_LIMIT - entry["attempts"]
        if remaining <= 0:
            return None, recovery_error("code_exhausted", "Too many incorrect codes. Request a new one.", 0)
        return None, recovery_error("invalid_code", "Incorrect verification code", remaining)


def claim_recovery_code(purpose, email, code, admin):
    """Takes the code out of the store so exactly one request can redeem it.

    Returns ``(entry, None)`` to the one request that gets it, or
    ``(None, response)`` when the code is no longer good: already redeemed,
    replaced by a newer one, used up or expired since this request checked it.
    Nothing is counted here; the guess was already judged right.
    """
    key = recovery_key(purpose, email)
    with recovery_lock:
        entry = reset_otps.get(key)
        if entry is None or entry["otp"] is None or entry["admin_id"] != admin.id or not recovery_code_matches(entry, code):
            return None, recovery_error("code_exhausted", "This code can no longer be used. Request a new one.", 0)
        if datetime.utcnow() >= entry["expires_at"]:
            return None, recovery_error("code_expired", "This code has expired. Request a new one.")
        if entry["attempts"] >= RECOVERY_ATTEMPT_LIMIT:
            return None, recovery_error("code_exhausted", "Too many incorrect codes. Request a new one.", 0)
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

        admin = find_recovery_admin(email)
        otp = issue_recovery_code(purpose, email, admin)
        if admin:
            send_recovery_otp(admin, purpose, otp)

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

        # The code is spent for good, even if this write fails: the admin asks
        # for a new one, and nothing can bring an old one back.
        admin.password = password_hash
        log_audit(
            "System", admin, "password reset", "Admin", admin.id,
            "Password reset by email verification code"
        )
        db.session.commit()

        return jsonify({"success": True, "username": admin.username}), 200

    except Exception as e:
        return recovery_failure(e)
