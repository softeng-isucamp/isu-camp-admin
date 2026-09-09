from collections import defaultdict, deque
import math
import time

from flask import Blueprint, request, jsonify, session
from flask_mail import Message
from dotenv import load_dotenv

from extensions import db, mail
from services.audit import log_audit

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


def _rate_limited(scope, key, limit, message):
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

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:
            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

        if admin.password != password:
            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

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

        otp = f"{secrets.randbelow(1000000):06d}"

        reset_otps[username] = {
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

        admin.password = password

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
