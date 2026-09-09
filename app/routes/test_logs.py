import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import logs as logs_module
from logs import logs_bp


class Query:
    def __init__(self, records): self.records = records
    def order_by(self, _): return self
    def all(self): return self.records


class Column:
    def desc(self): return self


def entry(identifier, created, category, actor, action, target, detail=None):
    return type("Log", (), {"id": identifier, "created_at": created, "category": category, "actor": actor, "action": action, "target": target, "target_id": None, "detail": detail, "to_dict": lambda self: {"id": str(self.id), "createdAt": self.created_at.isoformat(), "category": self.category, "actor": self.actor, "action": self.action, "target": self.target, "targetId": self.target_id, "detail": self.detail}})()


def client(monkeypatch, records):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(logs_module, "AuditLog", type("AuditLogModel", (), {"query": Query(records), "created_at": Column()}))
    return app.test_client()


def test_logs_filters_and_paginates(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [entry(1, now - timedelta(days=1), "Admin", "admin01", "Updated Location", "Library", "coordinates"), entry(2, now - timedelta(days=10), "User", "student", "Searched", "Library")]
    response = client(monkeypatch, records).get("/api/logs?category=Admin&q=COORD&date_range=7d&pageSize=1")
    assert response.status_code == 200
    assert response.json == {"items": [records[0].to_dict()], "total": 1, "page": 1, "pageSize": 1}


def test_logs_reject_invalid_filter(monkeypatch):
    assert client(monkeypatch, []).get("/api/logs?date_range=tomorrow").status_code == 400


def test_logs_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))
    assert app.test_client().get("/api/logs").status_code == 401
