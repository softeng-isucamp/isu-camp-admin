import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import users as users_module
from users import users_bp


class Query:
    def __init__(self, records): self.records = records
    def order_by(self, _): return self
    def all(self): return self.records


class Column:
    def asc(self): return self


def client(monkeypatch, records):
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(users_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(users_module, "AppUser", type("AppUserModel", (), {"query": Query(records), "id": Column()}))
    return app.test_client()


def user(identifier, username, created, signed_in=None, email=None):
    return type("User", (), {"id": identifier, "username": username, "email": email, "created_at": created, "last_sign_in_at": signed_in, "is_active": True, "to_dict": lambda self: {"id": str(self.id), "username": self.username, "email": self.email, "createdAt": self.created_at.isoformat(), "lastSignInAt": self.last_sign_in_at.isoformat() if self.last_sign_in_at else None, "isActive": self.is_active}})()


def test_users_search_date_filter_and_pagination(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [user(1, "admin01", now - timedelta(days=2), now - timedelta(days=1), "admin@example.com"), user(2, "old", now - timedelta(days=40), now - timedelta(days=40))]
    response = client(monkeypatch, records).get("/api/users?q=ADMIN&created_range=7d&page=1&pageSize=1")
    assert response.status_code == 200
    assert response.json == {"items": [records[0].to_dict()], "total": 1, "page": 1, "pageSize": 1}


def test_users_reject_invalid_pagination(monkeypatch):
    assert client(monkeypatch, []).get("/api/users?page=0").status_code == 400


def test_users_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(users_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))
    assert app.test_client().get("/api/users").status_code == 401
