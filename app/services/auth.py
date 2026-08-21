from flask import Blueprint, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy


# ==========================================
# Database
# ==========================================

db = SQLAlchemy()


# ==========================================
# Authentication Blueprint
# ==========================================

auth_bp = Blueprint(
    "auth",
    __name__,
    url_prefix="/api"
)


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