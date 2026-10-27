import logging
import time

from flask import Flask

import auth as auth_module
from auth import auth_bp
from services.security import verify_password


def auth_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    app.register_blueprint(auth_bp)
    return app


def test_login_is_rate_limited_server_side(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {"query": type("Query", (), {"filter_by": staticmethod(lambda **values: type("Result", (), {"first": lambda self: None})() )})()}))
    client = auth_app().test_client()

    responses = [client.post("/api/login", json={"username": "unknown", "password": "wrong"}) for _ in range(6)]

    assert [response.status_code for response in responses[:5]] == [401] * 5
    assert responses[5].status_code == 429
    assert responses[5].json["message"] == "Too many authentication requests. Please try again later."
    assert responses[5].headers["Retry-After"]


def test_login_rate_limits_invalid_request_bodies():
    auth_module.rate_limit_buckets.clear()
    client = auth_app().test_client()

    responses = [client.post("/api/login", json={}) for _ in range(6)]

    assert [response.status_code for response in responses[:5]] == [400] * 5
    assert responses[5].status_code == 429


def test_sending_a_reset_code_mails_only_the_accounts_own_address(monkeypatch):
    """The seam User Management's reset action shares with the recovery pages.

    The code is stored under the account's address, not its username, so the
    colleague redeems it on the forgot-password page like any other reset.
    """

    auth_module.reset_otps.clear()
    sent = []

    class FakeMessage:
        def __init__(self, **values):
            self.__dict__.update(values)

    monkeypatch.setattr(auth_module, "Message", FakeMessage)
    monkeypatch.setattr(auth_module, "mail", type("Mail", (), {
        "send": lambda self, message: sent.append((message.recipients, message.body)),
    })())
    monkeypatch.setattr(auth_module, "run_in_background", lambda deliver: deliver())
    admin = type("AdminRecord", (), {
        "id": 7, "username": "admin01", "gmail": "admin01@example.com", "is_active": True,
    })()
    monkeypatch.setattr(auth_module, "admins_with_email", lambda email: [admin])
    monkeypatch.setattr(auth_module, "authorize_recovery_subject", lambda subject: None)

    assert auth_module.send_password_reset_otp(admin) is None

    stored = auth_module.reset_otps[("password", "admin01@example.com")]["otp"]
    assert len(stored) == 6 and stored.isdigit()
    recipients, body = sent[0]
    assert recipients == ["admin01@example.com"]
    assert stored in body


def test_a_colleague_send_is_refused_for_an_address_recovery_cannot_resolve(monkeypatch):
    """An address two accounts share recovers neither, so no code is mailed for it.

    Reporting one as sent would leave the colleague holding a code the
    forgot-password page is bound to refuse.
    """

    auth_module.reset_otps.clear()
    sent = []
    monkeypatch.setattr(auth_module, "mail", type("Mail", (), {
        "send": lambda self, message: sent.append(message),
    })())
    admin = type("AdminRecord", (), {
        "id": 7, "username": "admin01", "gmail": "shared@example.com", "is_active": True,
    })()
    other = type("AdminRecord", (), {"id": 9, "is_active": True})()
    monkeypatch.setattr(auth_module, "admins_with_email", lambda email: [admin, other])

    with auth_app().app_context():
        response, status = auth_module.send_password_reset_otp(admin)

    assert status == 409
    assert response.get_json()["success"] is False
    assert sent == [] and auth_module.reset_otps == {}


def test_login_refuses_a_deactivated_administrator(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {
        "id": 3, "username": "admin01", "password": "password123", "is_active": False,
    })()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(
            lambda **values: type("Result", (), {"first": lambda self: admin})()
        )})()
    }))
    monkeypatch.setattr(auth_module, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {"commit": lambda self: None})())
    client = auth_app().test_client()

    response = client.post("/api/login", json={"username": "admin01", "password": "password123"})

    assert response.status_code == 403
    assert "deactivated" in response.json["message"]
    # No session was opened, so the refusal is not just cosmetic.
    with client.session_transaction() as flask_session:
        assert "admin_id" not in flask_session


def test_a_login_that_crashes_logs_the_exception_and_answers_without_it(monkeypatch, caplog):
    """A 5xx body reaches developer tools and every non-portal client as sent.

    The lookup's exception can name the admin table, its columns and the
    database connection, so the response carries only the fixed sentence and
    the detail goes to the log with its traceback.
    """

    auth_module.rate_limit_buckets.clear()

    def crash(**_values):
        raise RuntimeError('relation "admin" does not exist')

    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(crash)})()
    }))
    client = auth_app().test_client()

    with caplog.at_level(logging.ERROR, logger=auth_module.logger.name):
        response = client.post("/api/login", json={"username": "admin01", "password": "password123"})

    assert response.status_code == 500
    assert response.json == {"success": False, "message": "Login failed"}
    assert "does not exist" not in response.get_data(as_text=True)
    assert 'relation "admin" does not exist' in caplog.text


def test_a_session_ends_when_its_account_is_deactivated(monkeypatch):
    """Deactivation takes effect on the deactivated admin's next request."""

    admin = type("AdminRecord", (), {"id": 7, "username": "admin01", "is_active": False})()
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {
        "get": lambda self, model, key: admin,
        "commit": lambda self: None,
    })())
    client = auth_app().test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = 7
        flask_session["admin_username"] = "admin01"

    response = client.get("/api/me")

    assert response.status_code == 401
    with client.session_transaction() as flask_session:
        assert "admin_id" not in flask_session


def test_an_account_with_a_weak_stored_password_still_signs_in(monkeypatch):
    """The shared rules constrain new passwords only; nothing is re-checked at sign-in."""

    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {
        "id": 3, "username": "admin01", "password": "password123", "is_active": True,
        "to_profile": lambda self: {"id": 3},
    })()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(
            lambda **values: type("Result", (), {"first": lambda self: admin})()
        )})()
    }))
    monkeypatch.setattr(auth_module, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {"commit": lambda self: None})())

    response = auth_app().test_client().post("/api/login", json={"username": "admin01", "password": "password123"})

    assert response.status_code == 200


def test_login_remember_me_sets_permanent_session(monkeypatch):
    """Remember Me marks the session permanent so Flask attaches an expiry."""

    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {
        "id": 3, "username": "admin01", "password": "password123", "is_active": True,
        "to_profile": lambda self: {"id": 3},
    })()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(
            lambda **values: type("Result", (), {"first": lambda self: admin})()
        )})()
    }))
    monkeypatch.setattr(auth_module, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {"commit": lambda self: None})())

    client = auth_app().test_client()

    # When remember is true, session becomes permanent
    resp1 = client.post("/api/login", json={"username": "admin01", "password": "password123", "remember": True})
    assert resp1.status_code == 200
    with client.session_transaction() as flask_session:
        assert flask_session.permanent is True

    # When remember is omitted or false, session stays transient
    resp2 = client.post("/api/login", json={"username": "admin01", "password": "password123"})
    assert resp2.status_code == 200
    with client.session_transaction() as flask_session:
        assert flask_session.permanent is False


# ==========================================
# PASSWORD CONFIRMATION FOR DESTRUCTIVE ACTIONS
# ==========================================

def signed_in_client(monkeypatch, password="password123", admin_id=7):
    """A test client whose session is the given admin, as /api/login leaves it."""
    admin = type("AdminRecord", (), {
        "id": admin_id, "username": "admin01", "password": password, "is_active": True,
    })()
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {
        "get": lambda self, model, key: admin,
        "commit": lambda self: None,
    })())
    client = auth_app().test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = admin.username
    return client, admin


def test_confirm_password_rejects_an_unauthenticated_caller():
    auth_module.rate_limit_buckets.clear()
    client = auth_app().test_client()

    response = client.post("/api/confirm-password", json={"password": "password123"})

    assert response.status_code == 401


def test_confirm_password_accepts_the_signed_in_admin_password(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)

    response = client.post("/api/confirm-password", json={"password": "password123"})

    assert response.status_code == 200
    assert response.json["success"] is True
    assert response.json["expiresInSeconds"] == auth_module.REAUTH_MAX_AGE_SECONDS
    with client.session_transaction() as flask_session:
        assert isinstance(flask_session["reauth_at"], float)


def test_confirm_password_rejects_a_wrong_password_without_authorizing(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)

    response = client.post("/api/confirm-password", json={"password": "not-the-password"})

    assert response.status_code == 401
    assert response.json["message"] == "Password is incorrect"
    with client.session_transaction() as flask_session:
        assert "reauth_at" not in flask_session


def test_confirm_password_requires_a_password(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)

    response = client.post("/api/confirm-password", json={})

    assert response.status_code == 400
    assert response.json["message"] == "Password is required"


def test_confirm_password_is_rate_limited_per_admin(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)

    responses = [client.post("/api/confirm-password", json={"password": "wrong"}) for _ in range(6)]

    assert [response.status_code for response in responses[:5]] == [401] * 5
    assert responses[5].status_code == 429
    assert responses[5].headers["Retry-After"]


def test_reauth_required_blocks_until_the_password_is_confirmed(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)
    app = auth_app()

    @app.route("/api/_delete_probe", methods=["DELETE"])
    def delete_probe():
        _, error = auth_module.reauth_required()
        if error:
            return error
        return auth_module.jsonify({"success": True}), 200

    probe = app.test_client()
    with probe.session_transaction() as flask_session:
        flask_session["admin_id"] = 7
        flask_session["admin_username"] = "admin01"

    blocked = probe.delete("/api/_delete_probe")
    assert blocked.status_code == 403
    assert blocked.json["code"] == auth_module.REAUTH_REQUIRED_CODE

    with probe.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time()
    assert probe.delete("/api/_delete_probe").status_code == 200


def test_reauth_expires_after_its_window(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client, _ = signed_in_client(monkeypatch)
    app = auth_app()

    @app.route("/api/_expiry_probe", methods=["DELETE"])
    def expiry_probe():
        _, error = auth_module.reauth_required()
        if error:
            return error
        return auth_module.jsonify({"success": True}), 200

    probe = app.test_client()
    with probe.session_transaction() as flask_session:
        flask_session["admin_id"] = 7
        flask_session["admin_username"] = "admin01"
        flask_session["reauth_at"] = time.time() - auth_module.REAUTH_MAX_AGE_SECONDS - 1

    expired = probe.delete("/api/_expiry_probe")

    assert expired.status_code == 403
    assert expired.json["code"] == auth_module.REAUTH_REQUIRED_CODE
    # The stale stamp is cleared so it cannot be reused.
    with probe.session_transaction() as flask_session:
        assert "reauth_at" not in flask_session


def test_reauth_required_words_the_refusal_for_the_caller(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    signed_in_client(monkeypatch)
    app = auth_app()

    @app.route("/api/_default_probe", methods=["DELETE"])
    def default_probe():
        _, error = auth_module.reauth_required()
        return error

    @app.route("/api/_custom_probe", methods=["PUT"])
    def custom_probe():
        _, error = auth_module.reauth_required("Confirm your password to do the thing.")
        return error

    probe = app.test_client()
    with probe.session_transaction() as flask_session:
        flask_session["admin_id"] = 7
        flask_session["admin_username"] = "admin01"

    default = probe.delete("/api/_default_probe")
    custom = probe.put("/api/_custom_probe")

    assert default.json["message"] == "Confirm your password to delete this record."
    assert custom.json["message"] == "Confirm your password to do the thing."
    # The code is what the frontend reads, so wording never changes it.
    assert default.json["code"] == custom.json["code"] == auth_module.REAUTH_REQUIRED_CODE


