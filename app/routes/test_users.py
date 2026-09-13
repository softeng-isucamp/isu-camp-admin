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
    def all(self): return self.records


def client(monkeypatch, records):
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(users_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(users_module, "AppUser", type("AppUserModel", (), {"query": Query(records)}))
    return app.test_client()


def user(identifier, username, created):
    info = type("UserInfo", (), {"created_at": created})() if created is not None else None
    return type("User", (), {"id": identifier, "username": username, "info": info, "to_dict": lambda self: {"id": str(self.id), "username": self.username, "createdAt": self.info.created_at.isoformat() if self.info and self.info.created_at else None}})()


def test_users_search_date_filter_pagination_and_sort_order(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [user(1, "admin01", now - timedelta(days=2)), user(2, "old", now - timedelta(days=40))]
    response = client(monkeypatch, records).get("/api/users?q=ADMIN&created_range=7d&page=1&pageSize=1")
    assert response.status_code == 200
    assert response.json == {"items": [records[0].to_dict()], "total": 1, "page": 1, "pageSize": 1}


def test_users_sorted_newest_registered_first(monkeypatch):
    now = datetime.now(timezone.utc)
    oldest = user(1, "oldest", now - timedelta(days=10))
    newest = user(2, "newest", now - timedelta(days=1))
    without_info = user(3, "no-info", None)
    response = client(monkeypatch, [oldest, newest, without_info]).get("/api/users")
    assert response.status_code == 200
    assert [item["username"] for item in response.json["items"]] == ["newest", "oldest", "no-info"]


def test_users_reject_invalid_pagination(monkeypatch):
    assert client(monkeypatch, []).get("/api/users?page=0").status_code == 400


def test_users_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(users_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))
    assert app.test_client().get("/api/users").status_code == 401
