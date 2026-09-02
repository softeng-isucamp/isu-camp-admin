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


class FakeSession:
    def __init__(self):
        self.deleted = None
        self.commits = 0

    def delete(self, record):
        self.deleted = record

    def flush(self):
        pass

    def commit(self):
        self.commits += 1


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
