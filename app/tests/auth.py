from datetime import datetime, timedelta

from flask import Flask

import auth as auth_module
from auth import auth_bp
from services.security import hash_password, verify_password


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
    assert admin.password != "password123"
    assert verify_password(admin.password, "password123") == (True, False)
    assert "admin01" not in auth_module.reset_otps


# ==========================================
# Password Storage
# ==========================================

def _admin_module_stub(record):
    """Replace auth.Admin with a query that always returns one fake row."""
    return type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(
            lambda **values: type("Result", (), {"first": lambda self: record})()
        )})()
    })


def test_login_accepts_a_hashed_password_and_rejects_a_wrong_one(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {
        "id": 1, "username": "admin01", "password": hash_password("correct-horse1"),
    })()
    monkeypatch.setattr(auth_module, "Admin", _admin_module_stub(admin))
    monkeypatch.setattr(
        auth_module.db, "session",
        type("Session", (), {"commit": lambda self: None, "rollback": lambda self: None})(),
    )
    client = auth_app().test_client()

    accepted = client.post("/api/login", json={"username": "admin01", "password": "correct-horse1"})
    auth_module.rate_limit_buckets.clear()
    rejected = client.post("/api/login", json={"username": "admin01", "password": "wrong-horse1"})

    assert accepted.status_code == 200
    assert rejected.status_code == 401
    assert rejected.json["message"] == "Invalid username or password"


def test_login_upgrades_a_legacy_plaintext_password_to_a_hash(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {"id": 1, "username": "admin01", "password": "legacy-plaintext"})()
    monkeypatch.setattr(auth_module, "Admin", _admin_module_stub(admin))
    monkeypatch.setattr(
        auth_module.db, "session",
        type("Session", (), {"commit": lambda self: None, "rollback": lambda self: None})(),
    )
    client = auth_app().test_client()

    response = client.post("/api/login", json={"username": "admin01", "password": "legacy-plaintext"})

    assert response.status_code == 200
    # The row no longer holds the password itself, and the hash still verifies.
    assert admin.password != "legacy-plaintext"
    assert verify_password(admin.password, "legacy-plaintext") == (True, False)


# "contrasena1" with an n-tilde. Built with chr() so this file stays ASCII.
NON_ASCII_PASSWORD = "contrase" + chr(241) + "a1"


def test_login_upgrades_a_plaintext_password_containing_non_ascii(monkeypatch):
    """A password hand-entered in Supabase may hold accents or other non-ASCII."""
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {"id": 1, "username": "admin01", "password": NON_ASCII_PASSWORD})()
    monkeypatch.setattr(auth_module, "Admin", _admin_module_stub(admin))
    monkeypatch.setattr(
        auth_module.db, "session",
        type("Session", (), {"commit": lambda self: None, "rollback": lambda self: None})(),
    )
    client = auth_app().test_client()

    response = client.post("/api/login", json={"username": "admin01", "password": NON_ASCII_PASSWORD})

    assert response.status_code == 200
    assert verify_password(admin.password, NON_ASCII_PASSWORD) == (True, False)


def test_login_clears_any_pre_login_session_state(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    admin = type("AdminRecord", (), {
        "id": 1, "username": "admin01", "password": hash_password("correct-horse1"),
    })()
    monkeypatch.setattr(auth_module, "Admin", _admin_module_stub(admin))
    monkeypatch.setattr(
        auth_module.db, "session",
        type("Session", (), {"commit": lambda self: None, "rollback": lambda self: None})(),
    )
    app = auth_app()
    client = app.test_client()

    with client.session_transaction() as pre_login:
        pre_login["planted_by_attacker"] = "value"

    client.post("/api/login", json={"username": "admin01", "password": "correct-horse1"})

    with client.session_transaction() as after_login:
        assert "planted_by_attacker" not in after_login
        assert after_login["admin_id"] == 1


def test_login_does_not_leak_internal_errors(monkeypatch):
    auth_module.rate_limit_buckets.clear()

    def explode(**values):
        raise RuntimeError('connection to "db.internal:5432" failed')

    monkeypatch.setattr(auth_module, "Admin", type("Admin", (), {
        "query": type("Query", (), {"filter_by": staticmethod(explode)})()
    }))
    monkeypatch.setattr(
        auth_module.db, "session", type("Session", (), {"rollback": lambda self: None})(),
    )

    response = auth_app().test_client().post(
        "/api/login", json={"username": "admin01", "password": "whatever1"}
    )

    assert response.status_code == 500
    assert response.json == {"success": False, "message": "Login failed"}
    assert "db.internal" not in response.get_data(as_text=True)


# ==========================================
# Password Reset Hardening
# ==========================================

def test_reset_request_does_not_reveal_whether_an_account_exists(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    sent = []
    monkeypatch.setattr(auth_module, "Admin", _admin_module_stub(None))
    monkeypatch.setattr(auth_module, "mail", type("Mail", (), {
        "send": lambda self, message: sent.append(message)
    })())
    client = auth_app().test_client()

    response = client.post("/api/reset/request", json={"username": "does-not-exist"})

    assert response.status_code == 200
    assert response.json["success"] is True
    assert response.json["message"] == auth_module.GENERIC_RESET_REQUEST_MESSAGE
    # No code was issued and no mail went out for the unknown username.
    assert sent == []
    assert "does-not-exist" not in auth_module.reset_otps


def test_reset_code_is_discarded_after_repeated_wrong_guesses():
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=10),
        "attempts": 0,
    }

    for _ in range(auth_module.RESET_OTP_MAX_ATTEMPTS):
        client.post("/api/reset/verify", json={"username": "admin01", "code": "000000"})

    assert "admin01" not in auth_module.reset_otps


def test_reset_password_enforces_a_password_policy():
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=10),
        "attempts": 0,
    }

    too_short = client.post("/api/reset-password", json={
        "username": "admin01", "code": "123456", "password": "short1",
    })

    assert too_short.status_code == 400
    assert "at least 10 characters" in too_short.json["message"]
    # A rejected password must not spend the verification code.
    assert auth_module.reset_otps["admin01"]["otp"] == "123456"


def test_reset_password_rejects_a_password_containing_the_username():
    auth_module.rate_limit_buckets.clear()
    auth_module.reset_otps.clear()
    client = auth_app().test_client()
    auth_module.reset_otps["admin01"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=10),
        "attempts": 0,
    }

    response = client.post("/api/reset-password", json={
        "username": "admin01", "code": "123456", "password": "admin01-secret9",
    })

    assert response.status_code == 400
    assert response.json["message"] == "Password must not contain the username"
