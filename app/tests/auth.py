from datetime import datetime, timedelta
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
    """The seam User Management's reset action shares with the sign-in page."""

    auth_module.reset_otps.clear()
    sent = []

    class FakeMessage:
        def __init__(self, **values):
            self.__dict__.update(values)

    monkeypatch.setattr(auth_module, "Message", FakeMessage)
    monkeypatch.setattr(auth_module, "mail", type("Mail", (), {
        "send": lambda self, message: sent.append((message.recipients, message.body)),
    })())
    admin = type("AdminRecord", (), {"username": "admin01", "gmail": "admin01@example.com"})()

    auth_module.send_password_reset_otp(admin)

    stored = auth_module.reset_otps["admin01"]["otp"]
    assert len(stored) == 6 and stored.isdigit()
    recipients, body = sent[0]
    assert recipients == ["admin01@example.com"]
    assert stored in body


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


def test_reset_request_enforces_resend_cooldown(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {"username": "admin01", "gmail": "admin@example.com"})()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {"query": type("Query", (), {"filter_by": staticmethod(lambda **values: type("Result", (), {"first": lambda self: admin})() )})()}))
    class FakeMessage:
        def __init__(self, **values):
            self.__dict__.update(values)

    monkeypatch.setattr(auth_module, "Message", FakeMessage)
    monkeypatch.setattr(auth_module, "mail", type("Mail", (), {"send": lambda self, message: None})())
    client = auth_app().test_client()

    first = client.post("/api/reset/request", json={"username": "admin01"})
    resend = client.post("/api/reset/request", json={"username": "admin01"})

    assert first.status_code == 200
    assert resend.status_code == 429
    assert resend.json["message"] == "Too many password reset requests. Please wait before requesting another code."


def test_reset_request_rate_limits_invalid_request_bodies():
    auth_module.rate_limit_buckets.clear()
    client = auth_app().test_client()

    first = client.post("/api/reset/request", json={})
    second = client.post("/api/reset/request", json={})

    assert first.status_code == 400
    assert second.status_code == 429


def test_password_reset_endpoint_is_rate_limited(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    client = auth_app().test_client()

    responses = [client.post("/api/reset-password", json={"username": "admin01", "code": "000000", "password": "password123"}) for _ in range(6)]

    assert [response.status_code for response in responses[:5]] == [400] * 5
    assert responses[5].status_code == 429
    assert responses[5].json["message"] == "Too many password reset attempts. Please try again later."


def test_password_reset_rate_limits_invalid_request_bodies():
    auth_module.rate_limit_buckets.clear()
    client = auth_app().test_client()

    responses = [client.post("/api/reset-password", json={}) for _ in range(6)]

    assert [response.status_code for response in responses[:5]] == [400] * 5
    assert responses[5].status_code == 429


def test_reset_code_verification_rejects_wrong_and_expired_codes_without_consuming_a_valid_code():
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=1),
    }

    wrong = client.post("/api/reset/verify", json={"username": "admin01", "code": "000000"})
    correct = client.post("/api/reset/verify", json={"username": "admin01", "code": "123456"})

    assert wrong.status_code == 400
    assert wrong.json["message"] == "Invalid verification code"
    assert correct.status_code == 200
    assert auth_module.reset_otps["admin01"]["otp"] == "123456"

    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() - timedelta(seconds=1),
    }
    expired = client.post("/api/reset/verify", json={"username": "admin01", "code": "123456"})
    assert expired.status_code == 400
    assert expired.json["message"] == "Verification code has expired"


def test_reset_code_verification_is_rate_limited_with_retry_after():
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=1),
    }

    responses = [
        client.post("/api/reset/verify", json={"username": "admin01", "code": "000000"})
        for _ in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [400] * 5
    assert responses[5].status_code == 429
    assert int(responses[5].headers["Retry-After"]) > 0


def test_final_reset_remains_authoritative_after_non_consuming_verification(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    admin = type("AdminRecord", (), {"username": "admin01", "password": "old-password"})()
    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(
            lambda **values: type("Result", (), {"first": lambda self: admin})()
        )})()
    }))
    monkeypatch.setattr(auth_module.db, "session", type("Session", (), {"commit": lambda self: None})())
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=1),
    }

    verified = client.post("/api/reset/verify", json={"username": "admin01", "code": "123456"})
    wrong_final = client.post("/api/reset-password", json={
        "username": "admin01", "code": "000000", "password": "password123",
    })

    assert verified.status_code == 200
    assert wrong_final.status_code == 400
    assert wrong_final.json["message"] == "Invalid verification code"
    assert auth_module.reset_otps["admin01"]["otp"] == "123456"

    correct_final = client.post("/api/reset-password", json={
        "username": "admin01", "code": "123456", "password": "password123",
    })
    assert correct_final.status_code == 200
    # Stored as a hash now, not as the password itself, so the assertion is
    # that the new password verifies rather than that it is readable.
    assert admin.password != "password123"
    assert verify_password(admin.password, "password123")[0]
    assert "admin01" not in auth_module.reset_otps


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
