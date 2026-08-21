from flask import Blueprint, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_mail import Mail, Message
from dotenv import load_dotenv

import os
import secrets
from datetime import datetime, timedelta


# ==========================================
# Load Environment Variables
# ==========================================

load_dotenv()


# ==========================================
# Database
# ==========================================

db = SQLAlchemy()


# ==========================================
# Mail
# ==========================================

mail = Mail()


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

        if not data:

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

        print("LOGIN ATTEMPT:", username)

        # --------------------------------------
        # Find Admin
        # --------------------------------------

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:

            print("ADMIN NOT FOUND:", username)

            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

        print("ADMIN FOUND:", admin.username)

        # --------------------------------------
        # Password Check
        # --------------------------------------

        if admin.password != password:

            print("PASSWORD DOES NOT MATCH")

            return jsonify({
                "success": False,
                "message": "Invalid username or password"
            }), 401

        # --------------------------------------
        # Create Session
        # --------------------------------------

        session["admin_id"] = admin.id
        session["admin_username"] = admin.username

        print("LOGIN SUCCESS:", admin.username)

        return jsonify({

            "success": True,

            "message": "Login successful",

            "admin": {
                "id": admin.id,
                "username": admin.username
            }

        }), 200

    except Exception as e:

        print("LOGIN DATABASE ERROR:")
        print(e)

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

    admin = db.session.get(
        Admin,
        admin_id
    )

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

    admin = db.session.get(
        Admin,
        admin_id
    )

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

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        username = data.get("username")

        if not username:

            return jsonify({
                "success": False,
                "message": "Username is required"
            }), 400

        print("PASSWORD RESET REQUEST:", username)

        # --------------------------------------
        # Find Admin
        # --------------------------------------

        admin = Admin.query.filter_by(
            username=username
        ).first()

        if not admin:

            return jsonify({
                "success": False,
                "message": "Admin account not found"
            }), 404

        print("ADMIN FOUND:", admin.username)

        # --------------------------------------
        # Check Registered Gmail
        # --------------------------------------

        if not admin.gmail:

            return jsonify({
                "success": False,
                "message": "No Gmail address is registered for this account"
            }), 400

        # --------------------------------------
        # Generate 6-Digit OTP
        # --------------------------------------

        otp = f"{secrets.randbelow(1000000):06d}"

        print("GENERATED OTP:", otp)

        # --------------------------------------
        # Store OTP
        # --------------------------------------

        reset_otps[username] = {
            "otp": otp,
            "expires_at": datetime.utcnow() + timedelta(minutes=10)
        }

        # --------------------------------------
        # Create Email
        # --------------------------------------

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

        # --------------------------------------
        # Send Email
        # --------------------------------------

        mail.send(message)

        print("OTP SENT TO:", admin.gmail)

        return jsonify({
            "success": True,
            "message": "Verification code sent to the registered Gmail."
        }), 200

    except Exception as e:

        print("PASSWORD RESET EMAIL ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Failed to send verification code",
            "error": str(e)
        }), 500


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():

    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        username = data.get("username")
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

        if not secrets.compare_digest(str(reset["otp"]), str(otp)):
            return jsonify({
                "success": False,
                "message": "Invalid verification code"
            }), 400

        admin = Admin.query.filter_by(username=username).first()
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