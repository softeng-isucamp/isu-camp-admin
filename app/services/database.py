import sys
import os

# Add app and services folder to Python path
SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVICES_DIR)
ROOT_DIR = os.path.dirname(APP_DIR)

if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)


from datetime import timedelta
from urllib.parse import urlsplit, urlunsplit

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv

from extensions import db, mail
from auth import auth_bp
from model.location import Location
from model.app_user import AppUser
from model.audit_log import AuditLog

from routes.actions import actions_bp
from routes.location import location_bp
from routes.route_node import route_node_bp
from routes.map import map_bp   # <-- NEW IMPORT
from routes.users import users_bp
from routes.admins import admins_bp
from routes.logs import logs_bp
from routes.dashboard import dashboard_bp
from routes.profile import profile_bp
from routes.backups import backups_bp
from routes.building_types import building_types_bp

from services.backup_schedule import start_scheduler


# ==========================================
# Load Environment Variables
# ==========================================

load_dotenv(os.path.join(ROOT_DIR, ".env"))
load_dotenv()


# ==========================================
# Create Flask App
# ==========================================

app = Flask(__name__)


# ==========================================
# Flask Configuration
# ==========================================

# No default, deliberately. The session is a signed cookie and this key is the
# only thing that signs it, so a fallback value is a published master key: with
# it anyone can mint a cookie naming any admin_id and sign in as a superadmin
# without a password. Missing is therefore a startup failure, the same as a
# missing database URL below, rather than a quiet downgrade. Generate one with
# ``python -c "import secrets; print(secrets.token_hex(32))"``.
secret_key = os.getenv("SECRET_KEY")

if not secret_key:
    raise RuntimeError(
        "SECRET_KEY is missing from .env"
    )

app.config["SECRET_KEY"] = secret_key


# ==========================================
# Session Cookie
# ==========================================

# The session is a signed cookie rather than a server-side record, so these
# flags are the whole of its transport security.

# Keeps the cookie off plaintext HTTP. Nginx serves the portal on plain :8080
# and expects TLS to be terminated in front of it; a deployment with no
# terminator yet must set SESSION_COOKIE_SECURE=false until it has one, or the
# browser withholds the cookie and every sign-in looks like it succeeded and
# then immediately failed. Dev over http://127.0.0.1 is unaffected - browsers
# exempt loopback from this rule.
app.config["SESSION_COOKIE_SECURE"] = os.getenv(
    "SESSION_COOKIE_SECURE",
    "True"
).lower() in ("true", "1", "yes")

# Strict rather than Lax. Nothing outside the portal links into it, and in
# production the frontend and the API are the same origin behind the Nginx
# proxy, so the cookie never needs to ride a cross-site request. That same
# sameness is why the CORS allowlist protects nothing there, which leaves this
# as the only thing standing between a destructive route and a cross-site POST.
app.config["SESSION_COOKIE_SAMESITE"] = "Strict"

# Flask's default already, set here so all four live together and none can be
# lost to a change made somewhere else.
app.config["SESSION_COOKIE_HTTPONLY"] = True

# A signed cookie carries no expiry of its own, so without a lifetime a copy of
# one works for ever. Flask stamps a lifetime only onto a session marked
# permanent, which login() now does, and re-issues the cookie on each request
# (SESSION_REFRESH_EACH_REQUEST, on by default), making this an idle timeout
# rather than a hard one.
#
# This bounds a stolen cookie; it does not make a session revocable. Signing
# out, changing a password and demoting an account still cannot invalidate a
# cookie already in someone else's hands - that needs a server-side session
# record, which is a larger change than this one.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
    hours=int(os.getenv("SESSION_LIFETIME_HOURS") or 12)
)

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
    days=int(os.getenv("PERMANENT_SESSION_LIFETIME_DAYS", 30))
)


# ==========================================
# Proxy Headers
# ==========================================

# Nginx proxies every request, so left alone request.remote_addr is the proxy's
# own address on all of them and every per-IP limit in services.auth collapses
# into one bucket shared by the whole deployment - which turns the
# five-sign-ins-a-minute limit into a lockout any single client can trigger for
# everybody, and leaves a real attacker no more limited than anyone else.
#
# Off unless the deployment says how many proxies sit in front, because
# X-Forwarded-For is written by the caller: trusting it on a server that can be
# reached directly would let a client state its own address and defeat the
# limits outright. deploy/compose.yaml sets this to 1 for the Nginx in front of
# the API, where admin-api is only reachable on the internal network; a bare
# ``python database.py`` has no proxy and leaves it at 0.
#
# Only x_for is trusted. The other forwarded headers are left alone because
# deploy/nginx.conf does not set them, and a header nothing writes is a header
# anyone can.
TRUSTED_PROXY_COUNT = int(os.getenv("TRUSTED_PROXY_COUNT") or 0)

if TRUSTED_PROXY_COUNT > 0:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=TRUSTED_PROXY_COUNT,
        x_proto=0,
        x_host=0,
        x_port=0,
        x_prefix=0
    )


# ==========================================
# SMTP / Email Configuration
# ==========================================

app.config["MAIL_SERVER"] = os.getenv(
    "MAIL_SERVER",
    "smtp.resend.com"
)

app.config["MAIL_PORT"] = int(
    os.getenv("MAIL_PORT", 587)
)

app.config["MAIL_USE_TLS"] = os.getenv(
    "MAIL_USE_TLS",
    "True"
).lower() in ("true", "1", "yes")

app.config["MAIL_USE_SSL"] = os.getenv(
    "MAIL_USE_SSL",
    "False"
).lower() in ("true", "1", "yes")

app.config["MAIL_USERNAME"] = os.getenv(
    "MAIL_USERNAME",
    "resend"
)

app.config["MAIL_PASSWORD"] = os.getenv(
    "MAIL_PASSWORD"
)

app.config["MAIL_DEFAULT_SENDER"] = os.getenv(
    "MAIL_DEFAULT_SENDER",
    "onboarding@resend.dev"
)

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

# Both spellings of the loopback host, because they are different origins to a
# browser even though they are the same machine. The dev server is reached at
# either one - the documented API base is 127.0.0.1:5000 - and allowing only
# "localhost" meant every request from a frontend opened at 127.0.0.1 failed
# preflight, which the console reports as a CORS policy error rather than as a
# missing origin.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

# flask-cors owns every CORS header, preflight included. An earlier
# ``after_request`` here set the same headers by hand; because Flask runs
# after_request in reverse registration order it ran first, and flask-cors then
# skipped a response that already had Access-Control-Allow-Origin. That left
# this block configuring nothing and dropped the "Vary: Origin" flask-cors adds
# for a reflected origin, so a cache could serve one origin's response to
# another. One owner, so there is no second place to edit.
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": ALLOWED_ORIGINS,
            "methods": [
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "OPTIONS"
            ],
            "allow_headers": [
                "Content-Type",
                "Authorization"
            ],
            "expose_headers": ["Retry-After"],
            "supports_credentials": True
        }
    }
)


# ==========================================
# Unhandled Errors
# ==========================================

@app.errorhandler(Exception)
def handle_unexpected_error(error):
    """Turn a crash into a JSON 500 that still carries the CORS headers.

    Flask skips ``after_request`` when a view raises, so without this an
    unhandled error reaches the browser with no Access-Control-Allow-Origin and
    is reported as a CORS policy violation — which sends anyone debugging after
    the wrong problem. The response goes through ``after_request`` instead, so
    the console shows the real 500.
    """

    if isinstance(error, HTTPException):
        return error

    app.logger.exception("Unhandled error on %s %s", request.method, request.path)

    return jsonify({
        "success": False,
        "message": "The server could not complete the request."
    }), 500


# ==========================================
# Register Blueprints
# ==========================================

app.register_blueprint(auth_bp)
app.register_blueprint(location_bp)
app.register_blueprint(actions_bp)
app.register_blueprint(route_node_bp)
app.register_blueprint(map_bp)   # <-- NEW REGISTRATION
app.register_blueprint(users_bp)
app.register_blueprint(admins_bp)
app.register_blueprint(logs_bp)
app.register_blueprint(dashboard_bp)
app.register_blueprint(profile_bp)
app.register_blueprint(backups_bp)
app.register_blueprint(building_types_bp)


# ==========================================
# Automatic Backups
# ==========================================

# Started on import rather than from the __main__ block below, because a
# gunicorn worker only imports this module and would otherwise never get a
# timer. Off unless BACKUP_SCHEDULE_ENABLED is set, and safe to reach from more
# than one process - the dev reloader runs this file twice - because each run is
# claimed by a marker file. See services/backup_schedule.py.
start_scheduler(app)


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
