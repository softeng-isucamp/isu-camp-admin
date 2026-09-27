"""Application-level hardening: cookies, headers, origin policy, secret key.

``database`` builds its Flask app at import time, so the environment is set up
before the import rather than inside a fixture.
"""

import importlib
import os

import pytest

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("ADMIN_ALLOWED_ORIGINS", "https://admin.example.edu")

import database as database_module  # noqa: E402


@pytest.fixture
def client():
    return database_module.app.test_client()


# ==========================================
# Session Cookie
# ==========================================

def test_session_cookie_is_locked_down():
    config = database_module.app.config

    assert config["SESSION_COOKIE_HTTPONLY"] is True
    assert config["SESSION_COOKIE_SAMESITE"] == "Lax"
    assert config["SESSION_COOKIE_SECURE"] is True
    # Idle sessions must expire rather than stay valid forever.
    assert config["PERMANENT_SESSION_LIFETIME"].total_seconds() > 0
    assert config["SESSION_REFRESH_EACH_REQUEST"] is True


def test_request_bodies_are_capped():
    assert database_module.app.config["MAX_CONTENT_LENGTH"] > 0


def test_secret_key_is_not_a_shared_default():
    assert database_module.app.config["SECRET_KEY"] != "dev-secret-key"


# ==========================================
# Response Headers
# ==========================================

def test_responses_carry_the_security_headers(client):
    headers = client.get("/").headers

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert headers["Referrer-Policy"] == "no-referrer"
    assert headers["Cross-Origin-Opener-Policy"] == "same-origin"


def test_api_responses_are_not_cached(client):
    # An unauthenticated /api/me still exercises the after_request hook.
    assert client.get("/api/me").headers["Cache-Control"] == "no-store"


# ==========================================
# Origin Policy
# ==========================================

def test_allowed_origins_come_from_the_environment():
    assert "https://admin.example.edu" in database_module.ALLOWED_ORIGINS


def test_state_changing_request_from_an_untrusted_origin_is_blocked(client):
    response = client.post(
        "/api/login",
        json={"username": "admin01", "password": "whatever1"},
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
    assert response.json["message"] == "Request blocked: untrusted origin"


def test_state_changing_request_from_an_allowed_origin_is_not_blocked(client):
    response = client.post(
        "/api/logout",
        headers={"Origin": "https://admin.example.edu"},
    )

    assert response.status_code != 403


def test_read_requests_are_never_blocked_by_the_origin_guard(client):
    response = client.get("/api/me", headers={"Origin": "https://attacker.example"})

    # Reads still answer normally; 401 here is the auth check, not the guard.
    assert response.status_code == 401


# ==========================================
# Diagnostic Endpoints
# ==========================================

def test_unauthenticated_diagnostic_endpoints_are_gone():
    paths = {str(rule) for rule in database_module.app.url_map.iter_rules()}

    assert "/api/test-db" not in paths
    assert "/api/test-location" not in paths
    assert "/api/test-location-table" not in paths


def test_debug_mode_is_off_by_default():
    assert database_module.app.debug is False
