import sys
from pathlib import Path

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
