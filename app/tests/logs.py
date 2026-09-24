from datetime import datetime, timezone, timedelta

from flask import Flask

import logs as logs_module
from logs import logs_bp


class Query:
    def __init__(self, records): self.records = records
    def order_by(self, _): return self
    def all(self): return self.records


class Column:
    def desc(self): return self


def entry(identifier, created, category, actor, action, target, detail=None, target_id=None):
    return type("Log", (), {"id": identifier, "created_at": created, "category": category, "actor": actor, "action": action, "target": target, "target_id": target_id, "detail": detail, "to_dict": lambda self: {"id": str(self.id), "createdAt": self.created_at.isoformat(), "category": self.category, "actor": self.actor, "action": self.action, "target": self.target, "targetId": self.target_id, "detail": self.detail}})()


def client(monkeypatch, records, include_user_history=False):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(logs_module, "AuditLog", type("AuditLogModel", (), {"query": Query(records), "created_at": Column()}))
    if not include_user_history:
        monkeypatch.setattr(logs_module, "UserHistory", type("UserHistoryModel", (), {"query": Query([])}))
    return app.test_client()


def test_logs_filters_and_paginates(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [entry(1, now - timedelta(days=1), "Admin", "admin01", "Updated Location", "Library", "coordinates"), entry(2, now - timedelta(days=10), "User", "student", "Searched", "Library")]
    response = client(monkeypatch, records).get("/api/logs?category=Admin&q=COORD&date_range=7d&pageSize=1")
    assert response.status_code == 200
    assert response.json == {"items": [records[0].to_dict()], "total": 1, "page": 1, "pageSize": 1}


def test_logs_reject_invalid_filter(monkeypatch):
    assert client(monkeypatch, []).get("/api/logs?date_range=tomorrow").status_code == 400


def test_logs_filters_by_target_id(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [
        entry(1, now, "Admin", "admin01", "update", "Engineering Hall", target_id="4"),
        entry(2, now, "Admin", "admin01", "update", "Other Building", target_id="5"),
    ]

    response = client(monkeypatch, records).get("/api/logs?target_id=4")

    assert response.status_code == 200
    assert response.json["items"] == [records[0].to_dict()]
    assert response.json["total"] == 1


def test_logs_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))
    assert app.test_client().get("/api/logs").status_code == 401


def test_user_activity_includes_destination_selections(monkeypatch):
    now = datetime.now(timezone.utc)
    history = type("UserHistory", (), {
        "id": 17,
        "user_id": 9,
        "building_id": 4,
        "location_id": None,
        "created_at": now,
    })()
    user = type("User", (), {"id": 9, "username": "student01"})()
    building = type("Building", (), {"building_id": 4, "building_name": "Library"})()

    monkeypatch.setattr(logs_module, "UserHistory", type("UserHistoryModel", (), {"query": Query([history])}))
    monkeypatch.setattr(logs_module, "AppUser", type("AppUserModel", (), {
        "query": type("UserQuery", (), {"get": staticmethod(lambda identifier: user if identifier == 9 else None)})(),
    }))
    monkeypatch.setattr(logs_module, "Building", type("BuildingModel", (), {
        "query": type("BuildingQuery", (), {"get": staticmethod(lambda identifier: building if identifier == 4 else None)})(),
    }))
    monkeypatch.setattr(logs_module, "Location", type("LocationModel", (), {
        "query": type("LocationQuery", (), {"get": staticmethod(lambda _identifier: None)})(),
    }))

    response = client(monkeypatch, [], include_user_history=True).get("/api/logs?category=User")

    assert response.status_code == 200
    assert response.json["total"] == 1
    assert response.json["items"][0] == {
        "id": "user-history-17",
        "createdAt": now.isoformat(),
        "category": "User",
        "actor": "student01",
        "action": "Searched Building",
        "target": "Library",
        "targetId": "4",
        "detail": "Destination selected in the User App",
    }
