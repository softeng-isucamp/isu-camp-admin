import sys
import os
from datetime import timedelta

# Add app and services folder to Python path
SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVICES_DIR)
ROOT_DIR = os.path.dirname(APP_DIR)

if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)


import logging
import secrets
from urllib.parse import urlsplit, urlunsplit

from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

from extensions import db, mail
from auth import auth_bp
from services.security import allowed_origins, is_production

# Imported for their side effect: each module registers its table with the
# shared SQLAlchemy metadata.
from model.location import Location  # noqa: F401
from model.app_user import AppUser  # noqa: F401
from model.audit_log import AuditLog  # noqa: F401

from routes.actions import actions_bp
from routes.location import location_bp
from routes.route_node import route_node_bp
from routes.map import map_bp   # <-- NEW IMPORT
from routes.users import users_bp
from routes.logs import logs_bp
from routes.dashboard import dashboard_bp


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

logger = logging.getLogger(__name__)

PRODUCTION = is_production()


def _flag(name, default):
    return os.getenv(name, default).strip().lower() in ("true", "1", "yes")


# Session cookies are signed with this key, so a shared or guessable value
# lets anyone mint an authenticated admin cookie. Deployments must supply one;
# a development run gets a fresh random key per process instead of a constant.
secret_key = os.getenv("SECRET_KEY")

if not secret_key:

    if PRODUCTION:
        raise RuntimeError(
            "SECRET_KEY is missing. Set it in .env to a long random value "
            "(for example: python -c \"import secrets; print(secrets.token_hex(32))\")."
        )

    secret_key = secrets.token_hex(32)

    logger.warning(
        "SECRET_KEY is not set; using a random development key. "
        "Sessions will not survive a restart."
    )

app.config["SECRET_KEY"] = secret_key


# ==========================================
# Session Cookie Hardening
# ==========================================

# HttpOnly keeps the cookie out of reach of any script that lands on the page;
# SameSite=Lax stops another site from driving a state change with the admin's
# own cookie; Secure keeps it off plaintext HTTP. Secure is opt-out only so a
# local http://localhost run still works.
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = _flag(
    "SESSION_COOKIE_SECURE",
    "True" if PRODUCTION else "False"
)
app.config["SESSION_COOKIE_NAME"] = "isucamp_admin_session"

# Idle sessions expire instead of staying valid indefinitely. The lifetime is
# refreshed on each request, so it acts as an inactivity timeout.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
    minutes=int(os.getenv("SESSION_IDLE_MINUTES", "60"))
)
app.config["SESSION_REFRESH_EACH_REQUEST"] = True

# Reject oversized bodies before they are buffered. Photo uploads cap at 5 MB
# each and up to ten per request, so allow a little over that ceiling.
app.config["MAX_CONTENT_LENGTH"] = int(
    os.getenv("MAX_CONTENT_LENGTH_BYTES", str(56 * 1024 * 1024))
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

# The allowlist comes from ADMIN_ALLOWED_ORIGINS so a deployment is not stuck
# trusting localhost. Flask-CORS applies these headers by itself; the
# hand-written after_request duplicate that used to follow this block attached
# credentialed CORS headers to every route, /api or not, and is gone.
ALLOWED_ORIGINS = allowed_origins()

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": list(ALLOWED_ORIGINS),
            "methods": [
                "GET",
                "POST",
                "PUT",
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
# Cross-Site Request Forgery Guard
# ==========================================

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@app.before_request
def reject_cross_site_writes():
    """Refuse a state-changing call that a browser reports as cross-site.

    The session cookie is SameSite=Lax, which already blocks the common
    form-submission attack. This is the second layer: browsers attach an Origin
    header to cross-origin writes, so a value outside the allowlist is a
    forgery attempt regardless of what the cookie policy allowed. Requests with
    no Origin at all (curl, server-to-server, the test client) are left alone,
    since only a browser-driven request can carry the admin's cookie.
    """
    if request.method in SAFE_METHODS:
        return None

    origin = request.headers.get("Origin")

    if origin is None:
        return None
    if origin.rstrip("/") in ALLOWED_ORIGINS:
        return None

    return jsonify({
        "success": False,
        "message": "Request blocked: untrusted origin"
    }), 403


# ==========================================
# Security Response Headers
# ==========================================

@app.after_request
def add_security_headers(response):
    """Apply the headers that keep API responses from being misused."""

    # Never let a browser second-guess a declared Content-Type: that is what
    # turns an uploaded file into a script.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")

    # The API is not meant to be framed, and nothing here should execute or
    # load a subresource.
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'"
    )

    # Keep admin URLs out of Referer headers sent to third parties.
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")

    if PRODUCTION:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        )
        response.headers["Access-Control-Expose-Headers"] = "Retry-After"

    return response


# ==========================================
# Register Blueprints
# ==========================================

app.register_blueprint(auth_bp)
app.register_blueprint(location_bp)
app.register_blueprint(actions_bp)
app.register_blueprint(route_node_bp)
app.register_blueprint(map_bp)   # <-- NEW REGISTRATION
app.register_blueprint(users_bp)
app.register_blueprint(logs_bp)
app.register_blueprint(dashboard_bp)


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
# Database Connectivity Check
# ==========================================

# The /api/test-db, /api/test-location-table and /api/test-location endpoints
# that used to live here were unauthenticated and echoed raw driver errors and
# location rows to any caller. Use `flask shell` or the Supabase console for
# connectivity checks instead of shipping a public one.


# ==========================================
# Run Flask
# ==========================================

if __name__ == "__main__":

    # The Werkzeug debugger exposes an interactive console on any traceback, so
    # it stays off unless a developer opts in for this run.
    app.run(
        host=os.getenv("FLASK_RUN_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_RUN_PORT", "5000")),
        debug=_flag("FLASK_DEBUG", "False")
    )
