import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import actions as actions_module
from actions import actions_bp


class FakeQuery:
    def __init__(self, record):
        self.record = record

    def filter_by(self, **kwargs):
        return self

    def first(self):
        return self.record

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.record


class FakeColumn:
    def desc(self):
        return self


class FakeSession:
    def __init__(self):
        self.deleted = None
        self.commits = 0
        self.rollbacks = 0

    def delete(self, record):
        self.deleted = record

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_actions_blueprint_exposes_registered_action_routes(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))

    paths = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/api/actions/locations" in paths
    assert "/api/actions/locations/<int:location_id>" in paths
    assert "/api/actions/buildings/<int:building_id>/rooms" in paths
    assert "/api/actions/buildings/<int:building_id>/history" in paths


def test_actions_blueprint_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(
        actions_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app.test_client().get("/api/actions/locations")

    assert response.status_code == 401


def test_actions_can_delete_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()
    building = type("Building", (), {"building_id": 42})()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("Location", (), {"query": FakeQuery(None)}))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(building)}))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": session}))

    response = app.test_client().delete("/api/actions/locations/42")

    assert response.status_code == 200
    assert session.deleted is building


def test_actions_can_edit_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "OLD",
        "building_name": "Old Hall",
        "description": "Old description",
        "to_location_dto": lambda self: {"id": "42", "name": self.building_name, "code": self.building_code, "type": "Building"},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_all_locations", lambda: [])
    monkeypatch.setattr(actions_module, "_all_buildings", lambda: [building])
    monkeypatch.setattr(actions_module, "_photo_upload", lambda: (None, None, None))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": FakeSession()}))

    response = app.test_client().put("/api/actions/locations/42", json={"name": "New Hall", "code": "NEW", "type": "Building"})

    assert response.status_code == 200
    assert building.building_name == "New Hall"
    assert building.building_code == "NEW"


def _history_app(monkeypatch, building, history):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        actions_module,
        "Building",
        type("BuildingModel", (), {"query": FakeQuery(building)}),
    )
    monkeypatch.setattr(
        actions_module,
        "BuildingHistory",
        type(
            "BuildingHistoryModel",
            (),
            {"query": FakeQuery(history), "created_at": FakeColumn()},
        ),
    )
    return app


def test_building_history_returns_a_documented_empty_result(monkeypatch):
    app = _history_app(monkeypatch, type("Building", (), {})(), [])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 200
    assert response.json == {"success": True, "data": []}


def test_building_history_serializes_records_and_timestamps(monkeypatch):
    from datetime import datetime, timezone

    timestamp = datetime(2026, 9, 2, 8, 30, tzinfo=timezone.utc)
    record = type(
        "HistoryRecord",
        (),
        {
            "history_id": 7,
            "building_id": 42,
            "action": "Updated Building",
            "field": "building_name",
            "old_value": "Old Hall",
            "new_value": "New Hall",
            "changed_by": "admin01",
            "created_at": timestamp,
        },
    )()
    app = _history_app(monkeypatch, type("Building", (), {})(), [record])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 200
    assert response.json["data"] == [{
        "history_id": 7,
        "building_id": 42,
        "action": "Updated Building",
        "field": "building_name",
        "old_value": "Old Hall",
        "new_value": "New Hall",
        "changed_by": "admin01",
        "created_at": "2026-09-02T08:30:00+00:00",
    }]


def test_building_history_returns_404_for_a_missing_building(monkeypatch):
    app = _history_app(monkeypatch, None, [])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 404
    assert response.json == {"success": False, "message": "Building not found."}


def test_building_history_rolls_back_and_returns_500_on_query_failure(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()

    class FailingQuery(FakeQuery):
        def all(self):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(type("Building", (), {})())}))
    monkeypatch.setattr(actions_module, "BuildingHistory", type("BuildingHistoryModel", (), {"query": FailingQuery([]), "created_at": FakeColumn()}))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": session}))

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 500
    assert response.json == {"success": False, "message": "Failed to get building history."}
    assert session.rollbacks == 1
