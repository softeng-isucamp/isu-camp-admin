from collections import defaultdict, deque
import logging
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
    password_policy_error,
    verify_password,
)

import secrets
from datetime import datetime, timedelta

load_dotenv()


logger = logging.getLogger(__name__)


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

# Codes live in process memory, so cap the store and drop expired entries
# instead of letting an attacker grow it one username at a time.
RESET_OTP_MAX_ENTRIES = 1_000

# A code is discarded once this many wrong guesses have been made against it,
# so rate limiting is not the only thing standing between a guesser and a
# six-digit secret.
RESET_OTP_MAX_ATTEMPTS = 5

GENERIC_RESET_REQUEST_MESSAGE = (
    "If the username matches an admin account, a verification code has been "
    "sent to its registered Gmail."
)


def _prune_reset_otps():
    now = datetime.utcnow()
    for username in [key for key, value in reset_otps.items() if value["expires_at"] <= now]:
        reset_otps.pop(username, None)
    while len(reset_otps) > RESET_OTP_MAX_ENTRIES:
        reset_otps.pop(next(iter(reset_otps)), None)


def _active_reset(username):
    """Return the live OTP record for a username, clearing it once expired."""
    reset = reset_otps.get(username)

    if not reset or datetime.utcnow() > reset["expires_at"]:
        reset_otps.pop(username, None)
        return None
    return reset


def _record_failed_reset_attempt(username, reset):
    """Count a wrong code and burn the OTP once too many have been tried."""
    reset["attempts"] = reset.get("attempts", 0) + 1

    if reset["attempts"] >= RESET_OTP_MAX_ATTEMPTS:
        reset_otps.pop(username, None)


# These buckets are intentionally small and local to the backend process. They
# protect the current deployment without adding a new infrastructure service;
# a shared store can replace this seam when the app is scaled horizontally.
RATE_LIMIT_WINDOW_SECONDS = 60
rate_limit_buckets = defaultdict(deque)

# Every distinct client key allocates a bucket, so a flood of spoofed keys
# would otherwise grow the dict without bound. Sweep dead buckets whenever the
# store gets large rather than on a timer.
RATE_LIMIT_MAX_BUCKETS = 10_000


def _prune_rate_limit_buckets(cutoff):
    stale = [key for key, bucket in rate_limit_buckets.items() if not bucket or bucket[-1] <= cutoff]
    for key in stale:
        del rate_limit_buckets[key]


def _rate_limited(scope, key, limit, message):
    now = time.monotonic()
    cutoff_all = now - RATE_LIMIT_WINDOW_SECONDS

    if len(rate_limit_buckets) > RATE_LIMIT_MAX_BUCKETS:
        _prune_rate_limit_buckets(cutoff_all)

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


# ==========================================
# LOGIN
# ==========================================

@auth_bp.route("/login", methods=["POST"])
def login():

    try:

        data = request.get_json(silent=True)

        limited = _rate_limited(
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

        # A per-IP limit alone lets a botnet spread guesses for one account
        # across many addresses, so the targeted username is throttled too.
        limited = _rate_limited(
            "login-username",
            str(username).strip().lower(),
            10,
            "Too many authentication requests. Please try again later.",
        )
        if limited:
            return limited

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:

            # Spend the same work as a real password check so a missing
            # account is not distinguishable by response time.
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
            # The row still held a plaintext password. Replace it with a hash
            # now that the correct password has been proven once.
            admin.password = hash_password(password)

        # Drop anything a pre-login visitor may have put in the session so a
        # fixated cookie value cannot be reused as an authenticated one.
        session.clear()
        session.permanent = True
        session["admin_id"] = admin.id
        session["admin_username"] = admin.username
        log_audit("System", admin, "login", "Admin", admin.id, "Admin login successful")
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Login successful",
            "admin": {
                "id": admin.id,
                "username": admin.username
            }
        }), 200

    except Exception:

        db.session.rollback()

        # Logged for the operator; the client gets no internal detail.
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

    return jsonify({
        "authenticated": True,
        "admin": {
            "id": admin.id,
            "username": admin.username
        }
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

    return admin, None


# ==========================================
# REQUEST PASSWORD RESET OTP
# ==========================================

@auth_bp.route("/reset/request", methods=["POST"])
def request_reset():

    try:

        data = request.get_json(silent=True)
        username = str(data.get("username") or "") if isinstance(data, dict) else ""

        limited = _rate_limited(
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

        # The same answer is returned whether or not the account exists, and
        # whether or not it has an email on file. Telling an anonymous caller
        # which usernames are real hands them the first half of a login.
        if not admin or not admin.gmail:

            logger.info(
                "Password reset requested for an unusable account; no mail sent"
            )

            return jsonify({
                "success": True,
                "message": GENERIC_RESET_REQUEST_MESSAGE
            }), 200

        _prune_reset_otps()

        otp = f"{secrets.randbelow(1000000):06d}"

        reset_otps[username] = {
            "otp": otp,
            "expires_at": datetime.utcnow() + timedelta(minutes=10),
            "attempts": 0
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

        return jsonify({
            "success": True,
            "message": GENERIC_RESET_REQUEST_MESSAGE
        }), 200

    except Exception:

        logger.exception("Password reset email failed")

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

    limited = _rate_limited(
        "reset-verify",
        f"{request.remote_addr or 'unknown'}:{username.strip().lower()}",
        5,
        "Too many verification attempts. Please try again later.",
    )
    if limited:
        return limited

    if not username or not otp:
        return jsonify({"success": False, "message": "Username and verification code are required"}), 400

    reset = _active_reset(username)
    if not reset:
        return jsonify({"success": False, "message": "Verification code has expired"}), 400

    if not secrets.compare_digest(str(reset["otp"]), otp):
        _record_failed_reset_attempt(username, reset)
        return jsonify({"success": False, "message": "Invalid verification code"}), 400

    # A correct code is deliberately not consumed here: the final reset call
    # is the one that spends it, so the two-step UI keeps working.
    reset["attempts"] = 0

    return jsonify({"success": True, "message": "Verification code accepted"}), 200


# ==========================================
# RESET PASSWORD
# ==========================================

@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():

    try:

        data = request.get_json(silent=True)
        username = str(data.get("username") or "") if isinstance(data, dict) else ""

        limited = _rate_limited(
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

        policy_error = password_policy_error(password, username)

        if policy_error:
            return jsonify({
                "success": False,
                "message": policy_error
            }), 400

        reset = _active_reset(username)

        if not reset:

            return jsonify({
                "success": False,
                "message": "Verification code has expired"
            }), 400

        if not secrets.compare_digest(
            str(reset["otp"]),
            str(otp)
        ):
            _record_failed_reset_attempt(username, reset)

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

        log_audit(
            "System",
            admin,
            "reset-password",
            "Admin",
            getattr(admin, "id", None),
            "Admin password reset via verification code"
        )

        db.session.commit()

        reset_otps.pop(username, None)

        return jsonify({
            "success": True,
            "message": "Password reset successful"
        }), 200

    except Exception:

        db.session.rollback()

        logger.exception("Password reset failed")

        return jsonify({
            "success": False,
            "message": "Password reset failed"
        }), 500
