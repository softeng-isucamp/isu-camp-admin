from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os

from auth import auth_bp, db


# ==========================================
# Load Environment Variables
# ==========================================

load_dotenv()


# ==========================================
# Create Flask App
# ==========================================

app = Flask(__name__)


# ==========================================
# Flask Configuration
# ==========================================

app.config["SECRET_KEY"] = os.getenv(
    "SECRET_KEY",
    "dev-secret-key"
)


# ==========================================
# Supabase Database
# ==========================================

database_url = os.getenv("SUPABASE_DATABASE_URL")

if not database_url:
    raise RuntimeError(
        "SUPABASE_DATABASE_URL is missing from .env"
    )

# Do NOT print the password
if "@" in database_url:
    safe_database_url = database_url.split("@")[0] + "@********"
else:
    safe_database_url = "********"

print("Database URL loaded:", safe_database_url)

app.config["SQLALCHEMY_DATABASE_URI"] = database_url

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False


# ==========================================
# Initialize Database
# ==========================================

db.init_app(app)


# ==========================================
# CORS
# ==========================================

CORS(
    app,
    supports_credentials=True,
    origins=[
        "http://localhost:5173",
        "http://localhost:5174"
    ]
)


# ==========================================
# Authentication
# ==========================================

app.register_blueprint(auth_bp)


# ==========================================
# TEST 1 - Backend
# ==========================================

@app.route("/", methods=["GET"])
def home():

    return jsonify({
        "success": True,
        "message": "ISU-CAMP Backend is running"
    }), 200


# ==========================================
# TEST 2 - Database Connection
# ==========================================

@app.route("/api/test-db", methods=["GET"])
def test_db():

    try:

        with db.engine.connect() as connection:

            result = connection.execute(
                db.text("SELECT 1")
            )

            value = result.scalar()

        return jsonify({
            "success": True,
            "message": "Connected to Supabase!",
            "test_query": value
        }), 200

    except Exception as e:

        print("================================")
        print("DATABASE CONNECTION ERROR")
        print("================================")
        print(e)

        return jsonify({
            "success": False,
            "message": "Database connection failed",
            "error": str(e)
        }), 500


# ==========================================
# TEST 3 - Database Information
# ==========================================

@app.route("/api/test-db-info", methods=["GET"])
def test_db_info():

    try:

        with db.engine.connect() as connection:

            database_name = connection.execute(
                db.text("SELECT current_database()")
            ).scalar()

            username = connection.execute(
                db.text("SELECT current_user")
            ).scalar()

            version = connection.execute(
                db.text("SELECT version()")
            ).scalar()

        return jsonify({
            "success": True,
            "database": database_name,
            "user": username,
            "postgresql_version": version
        }), 200

    except Exception as e:

        print("DATABASE INFO ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve database information",
            "error": str(e)
        }), 500


# ==========================================
# TEST 4 - Check Admin Table
# ==========================================

@app.route("/api/test-admin-table", methods=["GET"])
def test_admin_table():

    try:

        with db.engine.connect() as connection:

            result = connection.execute(
                db.text("""
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_name = 'admin'
                    )
                """)
            )

            exists = result.scalar()

        if not exists:

            return jsonify({
                "success": False,
                "message": "The public.admin table does not exist."
            }), 404

        return jsonify({
            "success": True,
            "message": "The public.admin table exists."
        }), 200

    except Exception as e:

        print("ADMIN TABLE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not check admin table",
            "error": str(e)
        }), 500


# ==========================================
# TEST 5 - Count Admin Accounts
# ==========================================

@app.route("/api/test-admin-count", methods=["GET"])
def test_admin_count():

    try:

        with db.engine.connect() as connection:

            result = connection.execute(
                db.text("""
                    SELECT COUNT(*)
                    FROM public.admin
                """)
            )

            count = result.scalar()

        return jsonify({
            "success": True,
            "message": "Admin table queried successfully",
            "admin_count": count
        }), 200

    except Exception as e:

        print("ADMIN COUNT ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not count admin accounts",
            "error": str(e)
        }), 500


# ==========================================
# TEST 6 - Find Specific Admin
# ==========================================

@app.route("/api/test-admin", methods=["GET"])
def test_admin():

    try:

        from auth import Admin

        admin = Admin.query.filter_by(
            username="admin_justine"
        ).first()

        if not admin:

            return jsonify({
                "success": False,
                "message": "admin_justine was not found in the admin table"
            }), 404

        return jsonify({
            "success": True,
            "message": "Admin found",
            "admin": {
                "id": admin.id,
                "username": admin.username
            }
        }), 200

    except Exception as e:

        print("ADMIN DATABASE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not query admin table",
            "error": str(e)
        }), 500


# ==========================================
# TEST 7 - Test Username + Password
# ==========================================

@app.route("/api/test-login", methods=["GET"])
def test_login():

    try:

        from auth import Admin

        test_username = "admin_justine"
        test_password = "password123"

        admin = Admin.query.filter_by(
            username=test_username
        ).first()

        # ----------------------------------
        # Username check
        # ----------------------------------

        if not admin:

            return jsonify({
                "success": False,
                "step": "username",
                "message": "Username does not exist",
                "username": test_username
            }), 404

        # ----------------------------------
        # Password check
        # ----------------------------------

        if admin.password != test_password:

            return jsonify({
                "success": False,
                "step": "password",
                "message": "Username exists but password does not match",
                "username": test_username
            }), 401

        # ----------------------------------
        # Everything matches
        # ----------------------------------

        return jsonify({
            "success": True,
            "message": "Username and password match!",
            "admin": {
                "id": admin.id,
                "username": admin.username
            }
        }), 200

    except Exception as e:

        print("LOGIN TEST ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not test login",
            "error": str(e)
        }), 500


# ==========================================
# TEST 8 - Database Tables
# ==========================================

@app.route("/api/test-tables", methods=["GET"])
def test_tables():

    try:

        with db.engine.connect() as connection:

            result = connection.execute(
                db.text("""
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    ORDER BY table_name
                """)
            )

            tables = [
                {
                    "schema": row[0],
                    "table": row[1]
                }
                for row in result
            ]

        return jsonify({
            "success": True,
            "message": "Tables retrieved successfully",
            "tables": tables
        }), 200

    except Exception as e:

        print("TABLE LIST ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve tables",
            "error": str(e)
        }), 500


# ==========================================
# Run Flask
# ==========================================

if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )