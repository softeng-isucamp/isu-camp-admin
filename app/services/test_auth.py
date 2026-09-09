import sys
from pathlib import Path
from datetime import datetime, timedelta

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))

import auth as auth_module
from auth import auth_bp


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
    assert admin.password == "password123"
    assert "admin01" not in auth_module.reset_otps
