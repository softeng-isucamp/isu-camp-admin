from collections import defaultdict, deque
import math
import time

from flask import Blueprint, request, jsonify, session
from flask_mail import Message
from dotenv import load_dotenv

from extensions import db, mail
from services.audit import log_audit
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

reset_otps = {}


# These buckets are intentionally small and local to the backend process. They
# protect the current deployment without adding a new infrastructure service;
# a shared store can replace this seam when the app is scaled horizontally.
RATE_LIMIT_WINDOW_SECONDS = 60
rate_limit_buckets = defaultdict(deque)


def rate_limited(scope, key, limit, message):
    now = time.monotonic()
    bucket = rate_limit_buckets[(scope, key)]
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        retry_after = max(1, math.ceil(RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
        response = jsonify({"success": False, "message": message})
        response.headers["Retry-After"] = str(retry_after)
        return response, 429
    bucket.append(now)
    return None


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


def superadmin_required():
    """Guard a route that only a superadmin may use.

    Returns ``(admin, None)`` or ``(None, response)`` like
    :func:`admin_required`, so routes can chain the two. The role is read from
    the row on every request, so a demoted account is refused on its next call
    without its session being invalidated.
    """

    admin, error = admin_required()
    if error:
        return None, error

    if not admin.is_superadmin:
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

    otp = f"{secrets.randbelow(1000000):06d}"

    reset_otps[admin.username] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=10)
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

        if len(password) < 8:
            return jsonify({
                "success": False,
                "message": "Password must be at least 8 characters"
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
