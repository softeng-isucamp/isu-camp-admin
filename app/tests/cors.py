"""CORS contract for the admin portal's browser clients.

Every header here is one flask-cors owns. An earlier ``after_request`` in
``services.database`` set the same ones by hand and, because Flask runs
after_request in reverse registration order, won the race and silently
disabled this configuration - including the ``Vary: Origin`` flask-cors adds
for a reflected origin. These tests pin the behaviour rather than the
implementation, so collapsing the two owners stays verifiable.

A CORS failure is the kind that reports itself as the wrong problem: the
browser console blames a CORS policy whatever the real cause, so an
unreachable route, a crashed view and a genuinely disallowed origin all look
alike from the frontend. That is why the error statuses are covered too.
"""

import pytest

from database import ALLOWED_ORIGINS, app

# Registered at import time, before any test issues a request: Flask refuses a
# new route once the app has handled one, and this module is the only test that
# shares the real application object.
BOOM_PATH = "/api/__cors_test_boom"


@app.get(BOOM_PATH)
def _raise_for_cors_test():
    raise RuntimeError("deliberate failure, for the CORS error-path tests")


@pytest.fixture
def client():
    app.config["PROPAGATE_EXCEPTIONS"] = False
    return app.test_client()


def preflight(client, path, method, origin):
    return client.options(path, headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "content-type",
    })


# ==========================================
# ALLOWED ORIGINS
# ==========================================

@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_preflight_allows_every_documented_dev_origin(client, origin):
    response = preflight(client, "/api/dashboard", "GET", origin)

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert response.headers["Access-Control-Allow-Credentials"] == "true"


@pytest.mark.parametrize("port", ("5173", "5174"))
def test_preflight_allows_the_loopback_ip_as_well_as_localhost(client, port):
    """127.0.0.1 and localhost are one machine but two origins to a browser.

    The documented API base is 127.0.0.1:5000, so a frontend opened at
    127.0.0.1 is a normal way to run this. Allowing only the "localhost"
    spelling failed every request from it.
    """

    for host in ("localhost", "127.0.0.1"):
        response = preflight(client, "/api/users", "GET", f"http://{host}:{port}")
        assert response.headers.get("Access-Control-Allow-Origin") == f"http://{host}:{port}"


@pytest.mark.parametrize("origin", (
    "http://localhost:3000",
    "http://localhost",
    "https://localhost:5173",
    "http://127.0.0.1:5000",
    "https://evil.example.com",
))
def test_preflight_refuses_an_origin_that_is_not_allowed(client, origin):
    """A refused origin gets no header, which is what makes the browser block it.

    The status stays 200: rejection is the absence of
    Access-Control-Allow-Origin, not an error status, so asserting on the code
    here would pass for the wrong reason.
    """

    response = preflight(client, "/api/dashboard", "GET", origin)

    assert "Access-Control-Allow-Origin" not in response.headers


# ==========================================
# PREFLIGHTED METHODS
# ==========================================

@pytest.mark.parametrize("path, method", (
    ("/api/login", "POST"),
    ("/api/users/1/status", "PUT"),
    ("/api/admins", "POST"),
    ("/api/admins/1/status", "PUT"),
    ("/api/admins/1", "DELETE"),
    ("/api/locations", "POST"),
))
def test_preflight_allows_every_mutating_method_the_portal_sends(client, path, method):
    response = preflight(client, path, method, ALLOWED_ORIGINS[0])

    assert response.status_code == 200
    assert method in response.headers["Access-Control-Allow-Methods"]
    # Lowercased: flask-cors echoes the header name as the request spelled it
    # rather than as the configuration spells it. Header names are
    # case-insensitive, so the browser accepts either.
    assert "content-type" in response.headers["Access-Control-Allow-Headers"].lower()


def test_preflight_refuses_a_header_the_portal_does_not_send(client):
    """allow_headers is a list, not a wildcard, so an unlisted header is refused."""

    response = client.options("/api/admins", headers={
        "Origin": ALLOWED_ORIGINS[0],
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-smuggled-header",
    })

    assert "x-smuggled-header" not in response.headers.get(
        "Access-Control-Allow-Headers", ""
    ).lower()


def test_indoor_marker_patch_preflight_is_allowed_for_map_editor(client):
    response = preflight(
        client, "/api/map/buildings/1/indoor-locations/6", "PATCH",
        "http://localhost:5173",
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "PATCH" in response.headers["Access-Control-Allow-Methods"]


def test_preflight_is_answered_without_a_session(client):
    """A preflight carries no cookies, so requiring auth would block every write.

    Flask answers OPTIONS before the view runs, which is what keeps
    admin_required out of the way. A 401 here would make the browser refuse the
    real request that follows.
    """

    for path, method in (("/api/admins/1", "DELETE"), ("/api/users/1/status", "PUT")):
        response = preflight(client, path, method, ALLOWED_ORIGINS[0])
        assert response.status_code == 200


# ==========================================
# CACHING
# ==========================================

def test_preflight_varies_on_origin_so_a_cache_cannot_cross_origins(client):
    """Allow-Origin reflects the request, so the response is origin-specific.

    Without Vary: Origin a shared cache may hand one origin's response to
    another, which either leaks the header or blocks a legitimate caller.
    """

    response = preflight(client, "/api/dashboard", "GET", ALLOWED_ORIGINS[0])

    assert "Origin" in response.headers.get("Vary", "")


# ==========================================
# HEADER OWNERSHIP
# ==========================================

@pytest.mark.parametrize("header", (
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
    "Access-Control-Expose-Headers",
))
def test_cors_headers_are_set_exactly_once(client, header):
    """Two owners setting the same header can emit it twice, which browsers reject."""

    response = client.get("/api/dashboard", headers={"Origin": ALLOWED_ORIGINS[0]})

    assert len(response.headers.getlist(header)) == 1


def test_retry_after_is_readable_by_the_frontend(client):
    """services/api.ts checkRateLimit() reads Retry-After off a 429.

    A response header is invisible to JavaScript cross-origin unless it is
    exposed, so the rate-limit countdown depends on this.
    """

    response = client.get("/api/dashboard", headers={"Origin": ALLOWED_ORIGINS[0]})

    assert "Retry-After" in response.headers["Access-Control-Expose-Headers"]


# ==========================================
# ERROR RESPONSES
# ==========================================

@pytest.mark.parametrize("label, method, path, expected_status", (
    ("an unhandled crash", "get", BOOM_PATH, 500),
    ("an unknown route", "get", "/api/not-a-route", 404),
    ("a method the route rejects", "delete", "/api/dashboard", 405),
    ("an unauthenticated request", "get", "/api/dashboard", 401),
))
def test_error_responses_carry_cors_headers(client, label, method, path, expected_status):
    """Every failure the frontend can provoke must still be readable to it.

    Flask skips after_request when a view raises, so without the catch-all
    handler in services.database a 500 reaches the browser with no
    Access-Control-Allow-Origin and is reported as a CORS policy violation -
    sending whoever is debugging after the wrong problem. The same applies to
    the statuses Werkzeug raises before the view is reached.
    """

    origin = ALLOWED_ORIGINS[0]
    response = getattr(client, method)(path, headers={"Origin": origin})

    assert response.status_code == expected_status, label
    assert response.headers.get("Access-Control-Allow-Origin") == origin, label


def test_an_unhandled_crash_reports_a_json_error_rather_than_html(client):
    response = client.get(BOOM_PATH, headers={"Origin": ALLOWED_ORIGINS[0]})

    assert response.status_code == 500
    assert response.get_json() == {
        "success": False,
        "message": "The server could not complete the request.",
    }
