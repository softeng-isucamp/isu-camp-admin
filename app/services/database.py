import sys
import os

# Add app folder to Python path
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)


from urllib.parse import urlsplit, urlunsplit

from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from extensions import db, mail
from auth import auth_bp
from model.location import Location
from routes.actions import actions_bp
from routes.location import location_bp


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
# Gmail SMTP Configuration
# ==========================================

app.config["MAIL_SERVER"] = "smtp.gmail.com"
app.config["MAIL_PORT"] = 587
app.config["MAIL_USE_TLS"] = True
app.config["MAIL_USERNAME"] = os.getenv("MAIL_USERNAME")
app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD")
app.config["MAIL_DEFAULT_SENDER"] = os.getenv("MAIL_USERNAME")

mail.init_app(app)


# ==========================================
# Supabase Database
# ==========================================

database_url = os.getenv("SUPABASE_DATABASE_URL")

if not database_url:
    raise RuntimeError(
        "SUPABASE_DATABASE_URL is missing from .env"
    )


parsed_database_url = urlsplit(database_url)

if parsed_database_url.hostname:

    safe_netloc = parsed_database_url.hostname

    if parsed_database_url.port:
        safe_netloc += f":{parsed_database_url.port}"

    safe_database_url = urlunsplit(
        (
            parsed_database_url.scheme,
            safe_netloc,
            parsed_database_url.path,
            parsed_database_url.query,
            ""
        )
    )

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
# Register Authentication
# ==========================================

app.register_blueprint(auth_bp)
app.register_blueprint(location_bp)
app.register_blueprint(actions_bp)


# ==========================================
# Home
# ==========================================

@app.route("/", methods=["GET"])
def home():

    return jsonify({
        "success": True,
        "message": "ISU-CAMP Backend is running"
    }), 200


# ==========================================
# Test Database
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

        print("DATABASE CONNECTION ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Database connection failed",
            "error": str(e)
        }), 500

# ==========================================
# TEST LOCATION TABLE
# ==========================================

@app.route("/api/test-location-table", methods=["GET"])
def test_location_table():

    try:

        with db.engine.connect() as connection:

            result = connection.execute(
                db.text("""
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_name = 'location'
                    )
                """)
            )

            exists = result.scalar()

        if not exists:

            return jsonify({
                "success": False,
                "message": "The public.location table does not exist."
            }), 404

        return jsonify({
            "success": True,
            "message": "The public.location table exists."
        }), 200

    except Exception as e:

        print("LOCATION TABLE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not check location table",
            "error": str(e)
        }), 500

# ==========================================
# Test Location Table
# ==========================================

@app.route("/api/test-location", methods=["GET"])
def test_location():

    try:

        locations = Location.query.limit(10).all()

        return jsonify({
            "success": True,
            "message": "Location table queried successfully",
            "count": len(locations),
            "locations": [
                location.to_dict()
                for location in locations
            ]
        }), 200

    except Exception as e:

        print("LOCATION ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not query location table",
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
